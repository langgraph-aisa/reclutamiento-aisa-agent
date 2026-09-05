import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getPool, getUserById, getUserByOpenId } from "./db";
import { clearLocalSession, createLoginCode, hashLoginCode, issueLocalSession, LOGIN_CODE_MAX_ATTEMPTS, LOGIN_CODE_RESEND_SECONDS, LOGIN_CODE_TTL_MINUTES, maskEmail, sendLoginCode, setLocalSession, verifyLoginCode } from "./localAuth";
import { normalizePhone } from "./phone";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, recruiterProcedure, publicProcedure, router } from "./_core/trpc";

const statusValues = ["en_revision", "calificado", "no_calificado", "entrevista_iniciada", "entrevista_en_curso", "entrevista_finalizada", "pendiente_revision_humana", "error_procesamiento"] as const;
const roleProcedure = recruiterProcedure;

async function requirePool() {
  const pool = await getPool();
  if (!pool) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "PostgreSQL no está configurado todavía." });
  return pool;
}

function asJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function requestIp(req: { ip?: string; headers: Record<string, unknown> }) {
  const forwarded = req.headers["x-forwarded-for"];
  return String(Array.isArray(forwarded) ? forwarded[0] : forwarded || req.ip || "").split(",")[0]?.trim().slice(0, 80) || null;
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => {
      const user = opts.ctx.user;
      if (!user) return null;
      return { id: user.id, name: user.name, email: user.email, role: user.role, active: user.active, passwordChangeRequired: false };
    }),
    requestLoginCode: publicProcedure.input(z.object({ email: z.string().email().max(320) })).mutation(async ({ input, ctx }) => {
      const pool = await requirePool();
      const email = input.email.trim().toLowerCase();
      const result = await pool.query(`SELECT id,email FROM users WHERE lower(email)=lower($1) AND active=true LIMIT 1`, [email]);
      const user = result.rows[0];
      if (!user) return { success: true, email: maskEmail(email), expiresInMinutes: LOGIN_CODE_TTL_MINUTES, retryAfterSeconds: LOGIN_CODE_RESEND_SECONDS };
      const recent = await pool.query(`SELECT created_at FROM login_code_challenges WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`, [user.id]);
      if (recent.rows[0] && Date.now() - new Date(recent.rows[0].created_at).getTime() < LOGIN_CODE_RESEND_SECONDS * 1000) {
        return { success: true, email: maskEmail(user.email), expiresInMinutes: LOGIN_CODE_TTL_MINUTES, retryAfterSeconds: LOGIN_CODE_RESEND_SECONDS };
      }
      const code = createLoginCode();
      const codeHash = await hashLoginCode(code);
      await pool.query(`UPDATE login_code_challenges SET used_at=COALESCE(used_at,now()) WHERE user_id=$1 AND used_at IS NULL`, [user.id]);
      const challenge = await pool.query(`INSERT INTO login_code_challenges (user_id,code_hash,max_attempts,expires_at,requested_ip) VALUES ($1,$2,$3,now()+($4 * interval '1 minute'),$5) RETURNING id`, [user.id, codeHash, LOGIN_CODE_MAX_ATTEMPTS, LOGIN_CODE_TTL_MINUTES, requestIp(ctx.req)]);
      try {
        await sendLoginCode({ email: user.email, code, expiresInMinutes: LOGIN_CODE_TTL_MINUTES });
      } catch (error) {
        await pool.query(`UPDATE login_code_challenges SET used_at=now() WHERE id=$1`, [challenge.rows[0].id]);
        console.error("[Auth] SMTP login code delivery failed", error instanceof Error ? error.message : "unknown error");
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No fue posible enviar el código de acceso. Revisa la configuración SMTP en EasyPanel." });
      }
      return { success: true, email: maskEmail(user.email), expiresInMinutes: LOGIN_CODE_TTL_MINUTES, retryAfterSeconds: LOGIN_CODE_RESEND_SECONDS };
    }),
    verifyLoginCode: publicProcedure.input(z.object({ email: z.string().email().max(320), code: z.string().regex(/^\d{6}$/) })).mutation(async ({ input, ctx }) => {
      const pool = await requirePool();
      const client = await pool.connect();
      let user: Record<string, any> | undefined;
      try {
        await client.query("BEGIN");
        const result = await client.query(`SELECT c.id,c.code_hash,c.attempts,c.max_attempts,c.expires_at,u.id AS user_id,u.name,u.email,u.role FROM login_code_challenges c JOIN users u ON u.id=c.user_id WHERE lower(u.email)=lower($1) AND u.active=true AND c.used_at IS NULL ORDER BY c.created_at DESC LIMIT 1 FOR UPDATE OF c`, [input.email.trim()]);
        const challenge = result.rows[0];
        const valid = challenge && challenge.attempts < challenge.max_attempts && new Date(challenge.expires_at).getTime() > Date.now() && await verifyLoginCode(input.code, challenge.code_hash);
        if (!valid) {
          if (challenge) await client.query(`UPDATE login_code_challenges SET attempts=attempts+1,used_at=CASE WHEN attempts+1>=max_attempts OR expires_at<=now() THEN now() ELSE used_at END WHERE id=$1`, [challenge.id]);
          await client.query("COMMIT");
          throw new TRPCError({ code: "UNAUTHORIZED", message: "El código es inválido, expiró o superó el máximo de intentos." });
        }
        await client.query(`UPDATE login_code_challenges SET used_at=now() WHERE id=$1`, [challenge.id]);
        await client.query(`UPDATE users SET login_method='email_code',last_signed_in=now(),updated_at=now() WHERE id=$1`, [challenge.user_id]);
        await client.query("COMMIT");
        user = challenge;
      } catch (error) {
        if (!(error instanceof TRPCError)) await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      const token = await issueLocalSession(user!.user_id);
      setLocalSession(ctx.res, ctx.req, token);
      return { id: user!.user_id, name: user!.name, email: user!.email, role: user!.role, passwordChangeRequired: false };
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      if ((ctx.req.headers.cookie ?? "").includes("talento-claro-session=")) clearLocalSession(ctx.res, ctx.req);
      return { success: true } as const;
    }),
  }),

  users: router({
    list: adminProcedure.query(async () => { const pool = await requirePool(); const result = await pool.query(`SELECT id,name,email,role,active,created_at,updated_at,last_signed_in,password_change_required FROM users ORDER BY created_at DESC`); return result.rows; }),
    upsert: adminProcedure.input(z.object({ id: z.number().optional(), name: z.string().min(2).max(200), email: z.string().email(), role: z.enum(["admin", "reclutador"]), active: z.boolean().default(true) })).mutation(async ({ input }) => {
      const pool = await requirePool();
      const duplicate = await pool.query(`SELECT id FROM users WHERE lower(email)=lower($1) AND ($2::integer IS NULL OR id<>$2) LIMIT 1`, [input.email.trim(), input.id ?? null]);
      if (duplicate.rows[0]) throw new TRPCError({ code: "CONFLICT", message: "Ya existe un usuario con ese correo." });
      if (input.id) {
        const result = await pool.query(`UPDATE users SET name=$1,email=$2,role=$3,active=$4,login_method='email_code',password_hash=NULL,password_change_required=false,updated_at=now() WHERE id=$5 RETURNING id,name,email,role,active`, [input.name, input.email.trim().toLowerCase(), input.role, input.active, input.id]); return result.rows[0];
      }
      const result = await pool.query(`INSERT INTO users (open_id,name,email,login_method,role,password_hash,password_change_required,active) VALUES ($1,$2,$3,'email_code',$4,NULL,false,$5) RETURNING id,name,email,role,active`, [`email:${input.email.toLowerCase()}`, input.name, input.email.trim().toLowerCase(), input.role, input.active]); return result.rows[0];
    }),
    setActive: adminProcedure.input(z.object({ id: z.number(), active: z.boolean() })).mutation(async ({ input, ctx }) => { if (input.id === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "No puedes desactivarte a ti mismo." }); const pool = await requirePool(); await pool.query(`UPDATE users SET active=$1,updated_at=now() WHERE id=$2`, [input.active, input.id]); return { success: true }; }),
  }),

  profiles: router({
    list: adminProcedure.input(z.object({ search: z.string().max(120).optional(), active: z.boolean().optional() }).optional()).query(async ({ input }) => { const pool = await requirePool(); const values: unknown[] = []; const clauses: string[] = []; if (input?.search) { values.push(`%${input.search}%`); clauses.push(`(name ILIKE $${values.length} OR summary ILIKE $${values.length} OR academic_level ILIKE $${values.length})`); } if (input?.active !== undefined) { values.push(input.active); clauses.push(`active=$${values.length}`); } const result = await pool.query(`SELECT * FROM job_profiles ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC`, values); return result.rows; }),
    forPosition: adminProcedure.input(z.object({ positionId: z.number().int() })).query(async ({ input }) => { const pool = await requirePool(); const result = await pool.query(`SELECT p.* FROM job_profiles p JOIN job_profile_positions link ON link.profile_id=p.id WHERE link.job_position_id=$1 AND p.active=true ORDER BY p.updated_at DESC LIMIT 1`, [input.positionId]); return result.rows[0] ?? null; }),
    get: adminProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => { const pool = await requirePool(); const result = await pool.query(`SELECT * FROM job_profiles WHERE id=$1`, [input.id]); if (!result.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Perfil laboral no encontrado." }); const positions = await pool.query(`SELECT job_position_id FROM job_profile_positions WHERE profile_id=$1`, [input.id]); return { ...result.rows[0], position_ids: positions.rows.map(row => row.job_position_id) }; }),
    upsert: adminProcedure.input(z.object({ id: z.number().optional(), name: z.string().min(2).max(180), summary: z.string().max(2000).optional(), objective: z.string().max(5000).optional(), responsibilities: z.array(z.string().max(500)).default([]), requiredRequirements: z.array(z.string().max(500)).default([]), technicalSkills: z.array(z.string().max(200)).default([]), softSkills: z.array(z.string().max(200)).default([]), knowledge: z.array(z.string().max(200)).default([]), academicLevel: z.string().max(120).optional(), experienceYearsMin: z.number().int().min(0).max(60).optional(), experienceYearsMax: z.number().int().min(0).max(60).optional(), languages: z.array(z.string().max(120)).default([]), licenses: z.array(z.string().max(200)).default([]), availability: z.string().max(1000).optional(), location: z.string().max(1000).optional(), salaryRange: z.string().max(160).optional(), workMode: z.string().max(80).optional(), aiCriteria: z.string().max(5000).optional(), active: z.boolean().default(true), positionIds: z.array(z.number().int()).default([]) })).mutation(async ({ input, ctx }) => {
      const pool = await requirePool(); const client = await pool.connect();
      try { await client.query("BEGIN"); const values = [input.name, input.summary ?? null, input.objective ?? null, asJson(input.responsibilities), asJson(input.requiredRequirements), asJson(input.technicalSkills), asJson(input.softSkills), asJson(input.knowledge), input.academicLevel ?? null, input.experienceYearsMin ?? null, input.experienceYearsMax ?? null, asJson(input.languages), asJson(input.licenses), input.availability ?? null, input.location ?? null, input.salaryRange ?? null, input.workMode ?? null, input.aiCriteria ?? null, input.active]; let result;
        if (input.id) result = await client.query(`UPDATE job_profiles SET name=$1,summary=$2,objective=$3,responsibilities=$4::jsonb,required_requirements=$5::jsonb,technical_skills=$6::jsonb,soft_skills=$7::jsonb,knowledge=$8::jsonb,academic_level=$9,experience_years_min=$10,experience_years_max=$11,languages=$12::jsonb,licenses=$13::jsonb,availability=$14,location=$15,salary_range=$16,work_mode=$17,ai_criteria=$18,active=$19,updated_at=now() WHERE id=$20 RETURNING *`, [...values, input.id]);
        else result = await client.query(`INSERT INTO job_profiles (name,summary,objective,responsibilities,required_requirements,technical_skills,soft_skills,knowledge,academic_level,experience_years_min,experience_years_max,languages,licenses,availability,location,salary_range,work_mode,ai_criteria,active,created_by_user_id) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18,$19,$20) RETURNING *`, [...values, ctx.user.id]);
        const profileId = result.rows[0].id; await client.query(`DELETE FROM job_profile_positions WHERE profile_id=$1`, [profileId]); for (const positionId of input.positionIds) await client.query(`INSERT INTO job_profile_positions (profile_id,job_position_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [profileId, positionId]); await client.query("COMMIT"); return result.rows[0];
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    }),
    setActive: adminProcedure.input(z.object({ id: z.number(), active: z.boolean() })).mutation(async ({ input }) => { const pool = await requirePool(); await pool.query(`UPDATE job_profiles SET active=$1,updated_at=now() WHERE id=$2`, [input.active, input.id]); return { success: true }; }),
    remove: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => { const pool = await requirePool(); await pool.query(`UPDATE job_profiles SET active=false,updated_at=now() WHERE id=$1`, [input.id]); return { success: true }; }),
  }),

  publicJobs: router({
    getByToken: publicProcedure.input(z.object({ token: z.string().min(8).max(120) })).query(async ({ input }) => {
      const pool = await getPool();
      if (!pool) return null;
      const result = await pool.query(
        `SELECT p.id, p.public_slug, p.title, p.department, p.location_label, p.description, p.agent_key,
                f.id AS form_id, f.title AS form_title, f.intro AS form_intro,
                q.id AS question_id, q.field_key, q.label, q.help_text, q.type, q.required,
                q.order_index, q.answer_config, q.accepted_answers, q.hard_fail, q.evaluation_criteria
           FROM job_positions p
           JOIN application_forms f ON f.job_position_id = p.id AND f.published = true
           JOIN form_questions q ON q.form_id = f.id AND q.active = true
          WHERE p.public_slug = $1 AND p.published = true
          ORDER BY q.order_index ASC`,
        [input.token],
      );
      if (!result.rows.length) return null;
      const first = result.rows[0];
      return {
        id: first.id,
        token: first.public_slug,
        title: first.title,
        department: first.department,
        locationLabel: first.location_label,
        description: first.description,
        agentKey: first.agent_key,
        form: { id: first.form_id, title: first.form_title, intro: first.form_intro },
        questions: result.rows.map(row => ({
          id: row.question_id,
          fieldKey: row.field_key,
          label: row.label,
          helpText: row.help_text,
          type: row.type,
          required: row.required,
          orderIndex: row.order_index,
          answerConfig: row.answer_config ?? {},
          acceptedAnswers: row.accepted_answers ?? [],
          hardFail: row.hard_fail,
        })),
      };
    }),
    submit: publicProcedure.input(z.object({
      token: z.string().min(8).max(120),
      fullName: z.string().trim().min(2).max(240),
      email: z.string().email().max(320).optional().or(z.literal("")),
      phone: z.string().min(7).max(40),
      answers: z.record(z.string(), z.unknown()),
    })).mutation(async ({ input }) => {
      const pool = await requirePool();
      const phone = normalizePhone(input.phone, "GT");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const positionResult = await client.query(
          `SELECT p.id, f.id AS form_id FROM job_positions p
             JOIN application_forms f ON f.job_position_id = p.id AND f.published = true
            WHERE p.public_slug = $1 AND p.published = true LIMIT 1`,
          [input.token],
        );
        if (!positionResult.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "La plaza no está publicada o ya no está disponible." });
        const position = positionResult.rows[0];
        const duplicate = await client.query(
          `SELECT a.id FROM applications a JOIN candidates c ON c.id = a.candidate_id
            WHERE c.phone_international = $1 AND a.job_position_id = $2 LIMIT 1`,
          [phone.e164, position.id],
        );
        if (duplicate.rows[0]) {
          await client.query("ROLLBACK");
          return { alreadyApplied: true as const, message: "Esta solicitud ya fue enviada previamente para esta plaza." };
        }
        const candidate = await client.query(
          `INSERT INTO candidates (phone_international, phone_country, full_name, email)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (phone_international) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email, updated_at = now()
           RETURNING id`,
          [phone.e164, phone.country, input.fullName, input.email || null],
        );
        const application = await client.query(
          `INSERT INTO applications (candidate_id, job_position_id, form_id, status)
           VALUES ($1, $2, $3, 'en_revision') RETURNING id`,
          [candidate.rows[0].id, position.id, position.form_id],
        );
        const questions = await client.query(`SELECT id,field_key,required,type,answer_config FROM form_questions WHERE form_id = $1 AND active = true`, [position.form_id]);
        for (const question of questions.rows) {
          const value = input.answers[question.field_key];
          if (question.required && (value === undefined || value === null || String(value).trim() === "")) throw new TRPCError({ code: "BAD_REQUEST", message: `La respuesta ${question.field_key} es obligatoria.` });
          if (value === undefined) continue;
          const options = Array.isArray(question.answer_config?.options) ? question.answer_config.options.map(String) : [];
          if (question.type === "select" && options.length && !options.includes(String(value))) throw new TRPCError({ code: "BAD_REQUEST", message: `La respuesta seleccionada para ${question.field_key} no es válida.` });
          await client.query(
            `INSERT INTO application_answers (application_id, question_id, value_json, normalized_value)
             VALUES ($1, $2, $3::jsonb, $4)`,
            [application.rows[0].id, question.id, asJson(input.answers[question.field_key]), String(input.answers[question.field_key] ?? "")],
          );
        }
        await client.query("COMMIT");
        return { alreadyApplied: false as const, applicationId: application.rows[0].id, phone: phone.e164 };
      } catch (error) {
        await client.query("ROLLBACK");
        if (error instanceof TRPCError) throw error;
        if ((error as { code?: string }).code === "23505") return { alreadyApplied: true as const, message: "Esta solicitud ya fue enviada previamente para esta plaza." };
        throw error;
      } finally {
        client.release();
      }
    }),
  }),

  dashboard: router({
    summary: roleProcedure.query(async () => {
      const pool = await getPool();
      if (!pool) return { total: 0, enRevision: 0, calificados: 0, entrevistas: 0, positions: 0 };
      const result = await pool.query(`SELECT
        (SELECT count(*)::int FROM applications) AS total,
        (SELECT count(*)::int FROM applications WHERE status = 'en_revision') AS en_revision,
        (SELECT count(*)::int FROM applications WHERE status = 'calificado') AS calificados,
        (SELECT count(*)::int FROM applications WHERE status IN ('entrevista_iniciada','entrevista_en_curso','entrevista_finalizada')) AS entrevistas,
        (SELECT count(*)::int FROM job_positions) AS positions`);
      const row = result.rows[0];
      return { total: row.total ?? 0, enRevision: row.en_revision ?? 0, calificados: row.calificados ?? 0, entrevistas: row.entrevistas ?? 0, positions: row.positions ?? 0 };
    }),
  }),

  positions: router({
    list: roleProcedure.query(async () => {
      const pool = await getPool();
      if (!pool) return [];
      const result = await pool.query(`SELECT p.*, f.id AS form_id, f.title AS form_title, f.published AS form_published,
        (SELECT count(*)::int FROM applications a WHERE a.job_position_id = p.id) AS applications_count
        FROM job_positions p LEFT JOIN application_forms f ON f.job_position_id = p.id ORDER BY p.created_at DESC`);
      return result.rows;
    }),
    upsert: adminProcedure.input(z.object({
      id: z.number().optional(), code: z.string().min(2).max(80), title: z.string().min(2).max(180), department: z.string().max(160).optional(), locationLabel: z.string().max(240).optional(), description: z.string().max(5000).optional(), agentKey: z.string().min(2).max(120), whatsappMessage: z.string().max(1000).optional(), defaultCountry: z.string().length(2).default("GT"), published: z.boolean().default(false),
    })).mutation(async ({ input, ctx }) => {
      const pool = await requirePool();
      const publicSlug = input.id ? undefined : `${input.code.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
      if (input.id) {
        const result = await pool.query(`UPDATE job_positions SET code=$1,title=$2,department=$3,location_label=$4,description=$5,agent_key=$6,whatsapp_message=$7,default_country=$8,published=$9,updated_at=now() WHERE id=$10 RETURNING *`, [input.code, input.title, input.department ?? null, input.locationLabel ?? null, input.description ?? null, input.agentKey, input.whatsappMessage ?? null, input.defaultCountry, input.published, input.id]);
        return result.rows[0];
      }
      const result = await pool.query(`INSERT INTO job_positions (public_slug,code,title,department,location_label,description,agent_key,whatsapp_message,default_country,published,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [publicSlug, input.code, input.title, input.department ?? null, input.locationLabel ?? null, input.description ?? null, input.agentKey, input.whatsappMessage ?? null, input.defaultCountry, input.published, ctx.user.id]);
      await pool.query(`INSERT INTO application_forms (job_position_id,version,title,intro,published,created_by_user_id) VALUES ($1,1,$2,$3,false,$4)`, [result.rows[0].id, `Formulario · ${input.title}`, "Completa tus datos para aplicar a esta plaza.", ctx.user.id]);
      return result.rows[0];
    }),
    setPublished: adminProcedure.input(z.object({ id: z.number(), published: z.boolean() })).mutation(async ({ input }) => {
      const pool = await requirePool();
      const result = await pool.query(`UPDATE job_positions SET published=$1,updated_at=now() WHERE id=$2 RETURNING *`, [input.published, input.id]);
      return result.rows[0];
    }),
    remove: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => { const pool = await requirePool(); await pool.query(`DELETE FROM job_positions WHERE id=$1`, [input.id]); return { success: true }; }),
  }),

  candidates: router({
    list: roleProcedure.input(z.object({ status: z.enum(statusValues).optional(), search: z.string().max(120).optional(), positionId: z.number().optional(), from: z.string().optional(), to: z.string().optional() }).optional()).query(async ({ input }) => {
      const pool = await getPool();
      if (!pool) return [];
      const values: unknown[] = [];
      const clauses: string[] = [];
      if (input?.status) { values.push(input.status); clauses.push(`a.status = $${values.length}`); }
      if (input?.search) { values.push(`%${input.search}%`); clauses.push(`(c.full_name ILIKE $${values.length} OR c.phone_international ILIKE $${values.length} OR p.title ILIKE $${values.length})`); }
      if (input?.positionId) { values.push(input.positionId); clauses.push(`p.id = $${values.length}`); }
      if (input?.from) { values.push(input.from); clauses.push(`a.submitted_at >= $${values.length}`); }
      if (input?.to) { values.push(input.to); clauses.push(`a.submitted_at < ($${values.length}::date + interval '1 day')`); }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const result = await pool.query(`SELECT a.id, a.status, a.submitted_at, a.evaluation_at, a.evaluation_reason, a.profile_summary, a.whatsapp_status, c.full_name, c.phone_international, c.email, p.title AS position_title, p.public_slug FROM applications a JOIN candidates c ON c.id=a.candidate_id JOIN job_positions p ON p.id=a.job_position_id ${where} ORDER BY a.submitted_at DESC LIMIT 200`, values);
      return result.rows;
    }),
    detail: roleProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const pool = await requirePool();
      const application = await pool.query(`SELECT a.*, c.full_name, c.phone_international, c.email, p.title AS position_title, p.public_slug FROM applications a JOIN candidates c ON c.id=a.candidate_id JOIN job_positions p ON p.id=a.job_position_id WHERE a.id=$1`, [input.id]);
      if (!application.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Candidato no encontrado." });
      const answers = await pool.query(`SELECT q.label, q.field_key, aa.value_json, aa.normalized_value, aa.deterministic_result FROM application_answers aa JOIN form_questions q ON q.id=aa.question_id WHERE aa.application_id=$1 ORDER BY q.order_index`, [input.id]);
      const evaluations = await pool.query(`SELECT * FROM evaluations WHERE application_id=$1 ORDER BY created_at DESC`, [input.id]);
      const audit = await pool.query(`SELECT al.*, u.name AS actor_name FROM audit_log al LEFT JOIN users u ON u.id=al.actor_user_id WHERE al.entity_type='application' AND al.entity_id=$1 ORDER BY al.created_at DESC, al.id DESC`, [input.id]);
      const conversation = await pool.query(`SELECT * FROM conversations WHERE application_id=$1 ORDER BY created_at DESC LIMIT 1`, [input.id]);
      const messages = conversation.rows[0] ? await pool.query(`SELECT * FROM conversation_messages WHERE conversation_id=$1 ORDER BY created_at ASC`, [conversation.rows[0].id]) : { rows: [] };
      return { application: application.rows[0], answers: answers.rows, evaluations: evaluations.rows, audit: audit.rows, conversation: conversation.rows[0] ?? null, messages: messages.rows };
    }),
    setStatus: roleProcedure.input(z.object({ id: z.number(), status: z.enum(statusValues), comment: z.string().max(1000).optional() })).mutation(async ({ input, ctx }) => {
      const pool = await requirePool();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const before = await client.query(`SELECT * FROM applications WHERE id=$1 FOR UPDATE`, [input.id]);
        if (!before.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Candidato no encontrado." });
        const after = await client.query(`UPDATE applications SET status=$1, review_hold_until=CASE WHEN $1='calificado' THEN now() + interval '10 minutes' ELSE NULL END, updated_at=now() WHERE id=$2 RETURNING *`, [input.status, input.id]);
        const action = before.rows[0].status === input.status ? "comment_added" : "status_changed";
        const audit = await client.query(`INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,before_json,after_json,comment) VALUES ($1,'application',$2,$3,$4::jsonb,$5::jsonb,$6) RETURNING *`, [ctx.user.id, input.id, action, asJson(before.rows[0]), asJson(after.rows[0]), input.comment ?? null]);
        await client.query("COMMIT");
        const webhook = process.env.N8N_MANUAL_STATUS_WEBHOOK_URL;
        if (webhook) {
          void fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applicationId: input.id, status: input.status, actorType: "human", actorUserId: ctx.user.id, comment: input.comment ?? null }) }).catch(error => console.warn("[n8n] Manual status webhook failed:", error));
        }
        return { success: true as const, application: after.rows[0], audit: audit.rows[0] };
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    }),
  }),

  reports: router({
    overview: roleProcedure.input(z.object({ from: z.string().optional(), to: z.string().optional() }).optional()).query(async ({ input }) => {
      const pool = await getPool();
      if (!pool) return { byStatus: [], byPosition: [], reasons: [] };
      const values: unknown[] = [];
      const clauses: string[] = [];
      if (input?.from) { values.push(input.from); clauses.push(`a.submitted_at >= $${values.length}`); }
      if (input?.to) { values.push(input.to); clauses.push(`a.submitted_at < ($${values.length}::date + interval '1 day')`); }
      // CORRECCIÓN: Se agrega "WHERE 1=1" cuando no hay filtros para evitar error de sintaxis SQL
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "WHERE 1=1";
      const [byStatus, byPosition, reasons, responseTime] = await Promise.all([
        pool.query(`SELECT status, count(*)::int AS count FROM applications a ${where} GROUP BY status ORDER BY count DESC`, values),
        pool.query(`SELECT p.title, count(*)::int AS count FROM applications a JOIN job_positions p ON p.id=a.job_position_id ${where} GROUP BY p.title ORDER BY count DESC`, values),
        pool.query(`SELECT COALESCE(NULLIF(evaluation_reason,''),'Sin motivo') AS reason, count(*)::int AS count FROM applications a ${where} GROUP BY reason ORDER BY count DESC LIMIT 8`, values),
        pool.query(`SELECT ROUND(AVG(EXTRACT(EPOCH FROM (evaluation_at - submitted_at)) / 3600.0)::numeric, 1) AS average_hours FROM applications a ${where} AND evaluation_at IS NOT NULL`, values),
      ]);
      return { byStatus: byStatus.rows, byPosition: byPosition.rows, reasons: reasons.rows, responseTime: responseTime.rows[0] ?? { average_hours: null } };
    }),
  }),

  geo: router({
    departments: publicProcedure.input(z.object({ countryIso: z.string().length(2).default("GT") }).optional()).query(async ({ input }) => { const pool = await getPool(); if (!pool) return []; const result = await pool.query(`SELECT d.* FROM geo_departments d JOIN countries c ON c.id=d.country_id WHERE c.iso2=$1 AND d.active=true ORDER BY d.code`, [input?.countryIso ?? "GT"]); return result.rows; }),
    municipalities: publicProcedure.input(z.object({ departmentId: z.number() })).query(async ({ input }) => { const pool = await getPool(); if (!pool) return []; const result = await pool.query(`SELECT * FROM geo_municipalities WHERE department_id=$1 AND active=true ORDER BY code`, [input.departmentId]); return result.rows; }),
    adminCatalog: adminProcedure.query(async () => { const pool = await getPool(); if (!pool) return { departments: [], municipalities: [], zones: [] }; const [departments, municipalities, zones] = await Promise.all([pool.query(`SELECT d.id,d.code,d.name,d.active FROM geo_departments d ORDER BY d.code`), pool.query(`SELECT m.id,m.code,m.name,m.active,d.code AS department_code,d.name AS department_name FROM geo_municipalities m JOIN geo_departments d ON d.id=m.department_id ORDER BY m.code`), pool.query(`SELECT z.id,z.code,z.name,z.active,m.code AS municipality_code,m.name AS municipality_name FROM geo_zones z JOIN geo_municipalities m ON m.id=z.municipality_id ORDER BY z.code`)]); return { departments: departments.rows, municipalities: municipalities.rows, zones: zones.rows }; }),
    updateItem: adminProcedure.input(z.object({ entity: z.enum(["department", "municipality", "zone"]), id: z.number(), name: z.string().min(1).max(160), active: z.boolean() })).mutation(async ({ input }) => { const pool = await requirePool(); const table = input.entity === "department" ? "geo_departments" : input.entity === "municipality" ? "geo_municipalities" : "geo_zones"; const result = await pool.query(`UPDATE ${table} SET name=$1,active=$2 WHERE id=$3 RETURNING *`, [input.name, input.active, input.id]); return result.rows[0]; }),
    importCatalog: adminProcedure.input(z.object({ departments: z.array(z.object({ code: z.string(), name: z.string() })), municipalities: z.array(z.object({ departmentCode: z.string(), code: z.string(), name: z.string() })), zones: z.array(z.object({ municipalityCode: z.string(), code: z.string(), name: z.string() })).default([]) })).mutation(async ({ input }) => { const pool = await requirePool(); const client = await pool.connect(); try { await client.query("BEGIN"); await client.query(`INSERT INTO countries (iso2,name,dialing_code,active) VALUES ('GT','Guatemala','+502',true) ON CONFLICT (iso2) DO UPDATE SET active=true`); for (const department of input.departments) await client.query(`INSERT INTO geo_departments (country_id,code,name,active) SELECT id,$1,$2,true FROM countries WHERE iso2='GT' ON CONFLICT (country_id,code) DO UPDATE SET name=EXCLUDED.name,active=true`, [department.code, department.name]); for (const municipality of input.municipalities) await client.query(`INSERT INTO geo_municipalities (department_id,code,name,active) SELECT d.id,$1,$2,true FROM geo_departments d WHERE d.code=$3 AND d.country_id=(SELECT id FROM countries WHERE iso2='GT') ON CONFLICT (department_id,code) DO UPDATE SET name=EXCLUDED.name,active=true`, [municipality.code, municipality.name, municipality.departmentCode]); for (const zone of input.zones) await client.query(`INSERT INTO geo_zones (municipality_id,code,name,active) SELECT m.id,$1,$2,true FROM geo_municipalities m WHERE m.code=$3 ON CONFLICT (municipality_id,code) DO UPDATE SET name=EXCLUDED.name,active=true`, [zone.code, zone.name, zone.municipalityCode]); await client.query("COMMIT"); return { departments: input.departments.length, municipalities: input.municipalities.length, zones: input.zones.length }; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }),
  }),

  forms: router({
    getByPosition: adminProcedure.input(z.object({ positionId: z.number() })).query(async ({ input }) => {
      const pool = await getPool();
      if (!pool) return null;
      const form = await pool.query(`SELECT * FROM application_forms WHERE job_position_id=$1 ORDER BY version DESC LIMIT 1`, [input.positionId]);
      if (!form.rows[0]) return null;
      const questions = await pool.query(`SELECT * FROM form_questions WHERE form_id=$1 ORDER BY order_index`, [form.rows[0].id]);
      return { ...form.rows[0], questions: questions.rows };
    }),
    upsert: adminProcedure.input(z.object({ id: z.number().optional(), positionId: z.number(), title: z.string().min(2).max(240), intro: z.string().max(3000).optional(), published: z.boolean().default(false) })).mutation(async ({ input, ctx }) => {
      const pool = await requirePool();
      if (input.id) {
        const result = await pool.query(`UPDATE application_forms SET title=$1,intro=$2,published=$3,updated_at=now() WHERE id=$4 RETURNING *`, [input.title, input.intro ?? null, input.published, input.id]);
        return result.rows[0];
      }
      const version = await pool.query(`SELECT COALESCE(MAX(version),0)+1 AS version FROM application_forms WHERE job_position_id=$1`, [input.positionId]);
      const result = await pool.query(`INSERT INTO application_forms (job_position_id,version,title,intro,published,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [input.positionId, version.rows[0].version, input.title, input.intro ?? null, input.published, ctx.user.id]);
      return result.rows[0];
    }),
    saveQuestion: adminProcedure.input(z.object({ id: z.number().optional(), formId: z.number(), fieldKey: z.string().min(2).max(100), label: z.string().min(2), helpText: z.string().max(600).optional(), type: z.string().min(2).max(40), required: z.boolean().default(false), orderIndex: z.number().int().default(0), answerConfig: z.record(z.string(), z.unknown()).default({}), acceptedAnswers: z.array(z.unknown()).default([]), hardFail: z.boolean().default(false), evaluationCriteria: z.string().max(2000).optional(), aiPrompt: z.string().max(2000).optional() })).mutation(async ({ input }) => {
      const options = Array.isArray(input.answerConfig.options) ? input.answerConfig.options.map(String).filter(Boolean) : [];
      if (input.type === "select" && options.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Una pregunta de selección debe incluir al menos una opción." });
      const hasRange = [input.answerConfig.min, input.answerConfig.max, input.answerConfig.minMonths, input.answerConfig.maxMonths].some(value => value !== undefined && value !== null && value !== "");
      if (input.hardFail && input.acceptedAnswers.length === 0 && !hasRange) throw new TRPCError({ code: "BAD_REQUEST", message: "Una pregunta de descarte debe definir respuestas aprobadas o un rango permitido." });
      const pool = await requirePool();
      if (input.id) {
        const result = await pool.query(`UPDATE form_questions SET field_key=$1,label=$2,help_text=$3,type=$4,required=$5,order_index=$6,answer_config=$7::jsonb,accepted_answers=$8::jsonb,hard_fail=$9,evaluation_criteria=$10,ai_prompt=$11 WHERE id=$12 RETURNING *`, [input.fieldKey, input.label, input.helpText ?? null, input.type, input.required, input.orderIndex, asJson(input.answerConfig), asJson(input.acceptedAnswers), input.hardFail, input.evaluationCriteria ?? null, input.aiPrompt ?? null, input.id]);
        return result.rows[0];
      }
      const result = await pool.query(`INSERT INTO form_questions (form_id,field_key,label,help_text,type,required,order_index,answer_config,accepted_answers,hard_fail,evaluation_criteria,ai_prompt) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12) RETURNING *`, [input.formId, input.fieldKey, input.label, input.helpText ?? null, input.type, input.required, input.orderIndex, asJson(input.answerConfig), asJson(input.acceptedAnswers), input.hardFail, input.evaluationCriteria ?? null, input.aiPrompt ?? null]);
      return result.rows[0];
    }),
    deleteQuestion: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => { const pool = await requirePool(); const client = await pool.connect(); try { await client.query("BEGIN"); const current = await client.query(`SELECT form_id FROM form_questions WHERE id=$1 FOR UPDATE`, [input.id]); if (!current.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Pregunta no encontrada." }); await client.query(`DELETE FROM form_questions WHERE id=$1`, [input.id]); await client.query(`WITH ordered AS (SELECT id, row_number() OVER (ORDER BY order_index,id)-1 AS new_order FROM form_questions WHERE form_id=$1) UPDATE form_questions q SET order_index=ordered.new_order FROM ordered WHERE q.id=ordered.id`, [current.rows[0].form_id]); await client.query("COMMIT"); return { success: true }; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }),
    setPublished: adminProcedure.input(z.object({ id: z.number(), published: z.boolean() })).mutation(async ({ input }) => { const pool = await requirePool(); const result = await pool.query(`UPDATE application_forms SET published=$1,updated_at=now() WHERE id=$2 RETURNING *`, [input.published, input.id]); return result.rows[0]; }),
    remove: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => { const pool = await requirePool(); await pool.query(`DELETE FROM application_forms WHERE id=$1`, [input.id]); return { success: true }; }),
    setQuestionActive: adminProcedure.input(z.object({ id: z.number(), active: z.boolean() })).mutation(async ({ input }) => { const pool = await requirePool(); const result = await pool.query(`UPDATE form_questions SET active=$1 WHERE id=$2 RETURNING *`, [input.active, input.id]); return result.rows[0]; }),
    moveQuestion: adminProcedure.input(z.object({ id: z.number(), direction: z.enum(["up", "down"]) })).mutation(async ({ input }) => {
      const pool = await requirePool();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query(`SELECT id,form_id,order_index FROM form_questions WHERE id=$1 FOR UPDATE`, [input.id]);
        if (!current.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Pregunta no encontrada." });
        const delta = input.direction === "up" ? -1 : 1;
        const target = await client.query(`SELECT id,order_index FROM form_questions WHERE form_id=$1 AND order_index=$2 ORDER BY id LIMIT 1 FOR UPDATE`, [current.rows[0].form_id, current.rows[0].order_index + delta]);
        if (target.rows[0]) {
          await client.query(`UPDATE form_questions SET order_index=$1 WHERE id=$2`, [current.rows[0].order_index, target.rows[0].id]);
          await client.query(`UPDATE form_questions SET order_index=$1 WHERE id=$2`, [target.rows[0].order_index, current.rows[0].id]);
        }
        const result = await client.query(`SELECT * FROM form_questions WHERE id=$1`, [input.id]);
        await client.query("COMMIT");
        return result.rows[0];
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    }),
  }),

  config: router({
    settings: adminProcedure.query(async () => { const pool = await getPool(); if (!pool) return []; const result = await pool.query(`SELECT provider,setting_key,setting_value,is_secret FROM integration_settings WHERE provider IN ('recruitment','apichat') ORDER BY provider,setting_key`); return result.rows; }),
    saveSetting: adminProcedure.input(z.object({ provider: z.string().min(2).max(64), settingKey: z.string().min(2).max(120), settingValue: z.string().max(3000), isSecret: z.boolean().default(false) })).mutation(async ({ input }) => { const pool = await requirePool(); const result = await pool.query(`INSERT INTO integration_settings (provider,setting_key,setting_value,is_secret,updated_at) VALUES ($1,$2,$3,$4,now()) ON CONFLICT (provider,setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,is_secret=EXCLUDED.is_secret,updated_at=now() RETURNING provider,setting_key,setting_value,is_secret`, [input.provider, input.settingKey, input.settingValue, input.isSecret]); return result.rows[0]; }),
    recipients: adminProcedure.query(async () => {
      const pool = await getPool();
      if (!pool) return [];
      const result = await pool.query(`SELECT * FROM internal_alert_recipients ORDER BY label`);
      return result.rows;
    }),
    saveRecipient: adminProcedure.input(z.object({ id: z.number().optional(), label: z.string().min(2).max(120), phone: z.string().min(7).max(40), active: z.boolean().default(true) })).mutation(async ({ input }) => {
      const pool = await requirePool();
      const phone = normalizePhone(input.phone, "GT");
      if (input.id) {
        const result = await pool.query(`UPDATE internal_alert_recipients SET label=$1,phone_international=$2,active=$3 WHERE id=$4 RETURNING *`, [input.label, phone.e164, input.active, input.id]);
        return result.rows[0];
      }
      const result = await pool.query(`INSERT INTO internal_alert_recipients (label,phone_international,active) VALUES ($1,$2,$3) RETURNING *`, [input.label, phone.e164, input.active]);
      return result.rows[0];
    }),
  }),
});

export type AppRouter = typeof appRouter;
