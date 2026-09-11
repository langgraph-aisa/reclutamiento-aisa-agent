import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import {
  recordProcedureActivityBestEffort,
  shouldAuditProcedureActivity,
} from "../procedureActivityAudit";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

const auditAuthorizedMutation = t.middleware(async opts => {
  const { ctx, next, path, type } = opts;
  if (!ctx.user || !shouldAuditProcedureActivity(type, path)) {
    return next();
  }

  const startedAt = new Date();
  try {
    const result = await next();
    await recordProcedureActivityBestEffort({
      actorUserId: ctx.user.id,
      procedurePath: path,
      terminalResult: result.ok ? "completed" : "failed",
      startedAt,
    });
    return result;
  } catch (error) {
    await recordProcedureActivityBestEffort({
      actorUserId: ctx.user.id,
      procedurePath: path,
      terminalResult: "failed",
      startedAt,
    });
    throw error;
  }
});

export const protectedProcedure = t.procedure.use(requireUser);

export const recruiterProcedure = t.procedure
  .use(
    t.middleware(async opts => {
      const { ctx, next } = opts;
      if (!ctx.user || !["admin", "reclutador"].includes(ctx.user.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Se requiere rol de reclutador o administrador.",
        });
      }
      return next({ ctx: { ...ctx, user: ctx.user } });
    })
  )
  .use(auditAuthorizedMutation);

export const adminProcedure = t.procedure
  .use(
    t.middleware(async opts => {
      const { ctx, next } = opts;

      if (!ctx.user || ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
      }

      return next({
        ctx: {
          ...ctx,
          user: ctx.user,
        },
      });
    })
  )
  .use(auditAuthorizedMutation);
