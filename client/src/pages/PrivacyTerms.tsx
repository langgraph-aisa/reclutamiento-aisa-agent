import { AppBrand } from "@/components/AppBrand";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  APPLICATION_CONSENT_VERSION,
  PRIVACY_TERMS_PATH,
} from "@shared/applicationConsent";
import {
  Bot,
  CheckCircle2,
  ExternalLink,
  FileText,
  LockKeyhole,
  Mail,
  Printer,
  ShieldCheck,
  UserRoundCheck,
  X,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";

const DOCUMENT_TITLE =
  "PRIVACIDAD, TÉRMINOS Y CONDICIONES DE USO DE LA PLATAFORMA";
const DOCUMENT_DESCRIPTION =
  "Aviso de privacidad, términos y condiciones aplicables a Talento AISA y a sus procesos de postulación y selección.";

type LegalSection = {
  id: string;
  title: string;
  content: ReactNode;
};

const termsSections: LegalSection[] = [
  {
    id: "identificacion-servicio",
    title: "1. Identificación y alcance del servicio",
    content: (
      <>
        <p>
          Talento AISA es una plataforma tecnológica operada por Alternativas
          Inteligentes, S.A. (AISA) para publicar oportunidades laborales,
          recibir postulaciones, recopilar información curricular, asistir la
          evaluación de perfiles y facilitar la revisión humana.
        </p>
        <p>
          Estas condiciones regulan el acceso y uso de la plataforma por
          candidatos, personal autorizado y demás personas que utilicen sus
          funciones. La postulación se limita a la plaza seleccionada y no crea
          por sí sola una relación laboral.
        </p>
      </>
    ),
  },
  {
    id: "aceptacion-requisitos",
    title: "2. Aceptación y requisitos de postulación",
    content: (
      <>
        <p>
          Antes de enviar una postulación, la persona confirma que leyó este
          documento, que es mayor de dieciocho años y que la información
          proporcionada corresponde a su identidad y trayectoria.
        </p>
        <p>
          La información debe ser verdadera, exacta, completa y actualizada. Una
          falsedad, alteración, suplantación o documento fraudulento puede
          ocasionar la exclusión del proceso y las consecuencias legalmente
          procedentes.
        </p>
      </>
    ),
  },
  {
    id: "proceso-seleccion",
    title: "3. Naturaleza del proceso de selección",
    content: (
      <>
        <p>
          Cada plaza puede establecer requisitos, preguntas y etapas diferentes.
          La publicación de una oportunidad, recepción de una postulación,
          puntuación, clasificación, entrevista o comunicación no constituye
          oferta, promesa ni garantía de contratación.
        </p>
        <p>
          La decisión final corresponde a AISA o al responsable autorizado de la
          oportunidad. El estado de una postulación puede actualizarse conforme
          avance la evaluación.
        </p>
      </>
    ),
  },
  {
    id: "inteligencia-artificial",
    title: "4. Inteligencia artificial y revisión humana",
    content: (
      <>
        <p>
          Talento AISA puede utilizar inteligencia artificial para organizar
          respuestas, comparar evidencia declarada con requisitos, generar
          indicadores, puntuaciones, observaciones o recomendaciones y apoyar la
          priorización del trabajo de reclutamiento.
        </p>
        <p>
          Estas salidas son apoyo operativo: no son una verdad objetiva sobre la
          persona ni sustituyen la responsabilidad institucional. Pueden ser
          revisadas, corregidas o reevaluadas por personal autorizado. Una
          persona candidata puede solicitar aclaración o corrección mediante el
          canal de contacto indicado en este documento.
        </p>
      </>
    ),
  },
  {
    id: "uso-responsable",
    title: "5. Uso responsable y conductas prohibidas",
    content: (
      <>
        <p>
          La plataforma debe utilizarse exclusivamente para fines legítimos.
        </p>
        <ul>
          <li>No suplantar identidades ni aportar información fraudulenta.</li>
          <li>No vulnerar controles, cuentas, información o sistemas.</li>
          <li>No introducir código malicioso ni degradar el servicio.</li>
          <li>
            No extraer datos, automatizar abusivamente acciones o interferir con
            evaluaciones.
          </li>
          <li>
            No copiar, vender, sublicenciar o explotar componentes protegidos
            sin autorización.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "disponibilidad-terceros",
    title: "6. Disponibilidad, mantenimiento y terceros",
    content: (
      <>
        <p>
          AISA procurará una disponibilidad razonable, pero pueden ocurrir
          mantenimientos, actualizaciones, fallos de conectividad o
          indisponibilidad de proveedores. Las integraciones de infraestructura,
          correo, mensajería, almacenamiento, analítica o inteligencia
          artificial pueden estar sujetas a condiciones propias de sus
          proveedores.
        </p>
        <p>
          Una interrupción no amplía ni elimina derechos que por ley sean
          irrenunciables. Cuando sea razonablemente posible, AISA aplicará
          medidas de continuidad y corrección.
        </p>
      </>
    ),
  },
  {
    id: "propiedad-intelectual",
    title: "7. Propiedad intelectual",
    content: (
      <p>
        Software, arquitectura, diseños, interfaces, documentación, logotipos,
        marcas y contenidos pertenecen a sus respectivos titulares. El acceso
        concede únicamente una autorización limitada, revocable y no
        transferible para utilizar la plataforma conforme a estas condiciones.
      </p>
    ),
  },
  {
    id: "comunicaciones-electronicas",
    title: "8. Comunicaciones electrónicas",
    content: (
      <p>
        La persona acepta recibir comunicaciones relacionadas con su postulación
        mediante los datos facilitados, incluidos correo y mensajería. Las
        comunicaciones electrónicas se interpretan conforme al Decreto 47-2008,
        cuando resulte aplicable, sin perjuicio de las normas de protección al
        consumidor y demás disposiciones imperativas.
      </p>
    ),
  },
  {
    id: "responsabilidad-ley",
    title: "9. Responsabilidad, ley aplicable y controversias",
    content: (
      <>
        <p>
          Talento AISA no garantiza entrevista, contratación, permanencia de una
          plaza ni resultado laboral. Ninguna limitación de este documento
          excluye responsabilidades o derechos que legalmente no puedan
          excluirse, incluidos los que correspondan bajo el Decreto 06-2003.
        </p>
        <p>
          Estas condiciones se rigen por las leyes de la República de Guatemala.
          Las controversias se someterán a las autoridades competentes, salvo un
          mecanismo válido acordado conforme a la ley.
        </p>
      </>
    ),
  },
  {
    id: "cambios-condiciones",
    title: "10. Cambios a las condiciones",
    content: (
      <p>
        AISA puede actualizar este documento por cambios legales, técnicos,
        operativos o de seguridad. La plataforma mostrará la versión vigente y
        comunicará modificaciones sustanciales mediante un mecanismo razonable.
        Una nueva aceptación podrá solicitarse cuando corresponda.
      </p>
    ),
  },
];

const privacySections: LegalSection[] = [
  {
    id: "responsable-datos",
    title: "1. Responsable y contacto",
    content: (
      <>
        <p>
          <strong>Responsable:</strong> Alternativas Inteligentes, S.A. (AISA).
        </p>
        <p>
          <strong>Domicilio:</strong> Boulevard Los Próceres 17-42, Ciudad de
          Guatemala 01010, Guatemala.
        </p>
        <p>
          <strong>Correo:</strong>{" "}
          <a href="mailto:adminit@aisa.com.gt">adminit@aisa.com.gt</a>
          <br />
          <strong>Teléfono:</strong>{" "}
          <a href="tel:+50223670227">+502 2367 0227</a>
        </p>
      </>
    ),
  },
  {
    id: "datos-recopilados",
    title: "2. Información tratada",
    content: (
      <ul>
        <li>
          Identificación y contacto: nombre, teléfono, correo y ubicación
          declarada.
        </li>
        <li>
          Información profesional: experiencia, formación, conocimientos,
          competencias, currículo y respuestas.
        </li>
        <li>
          Información del proceso: plaza, fechas, estados, evaluaciones,
          comentarios, entrevistas y comunicaciones.
        </li>
        <li>
          Información técnica y de seguridad: IP, navegador, sesión, eventos y
          registros necesarios para operar y proteger la plataforma.
        </li>
        <li>
          Información derivada: indicadores, coincidencias, puntuaciones,
          observaciones y recomendaciones de apoyo.
        </li>
      </ul>
    ),
  },
  {
    id: "finalidades",
    title: "3. Finalidades del tratamiento",
    content: (
      <ul>
        <li>Recibir, validar y administrar postulaciones.</li>
        <li>Evaluar correspondencia con los requisitos de una plaza.</li>
        <li>Coordinar entrevistas y comunicaciones del proceso.</li>
        <li>
          Apoyar evaluación humana mediante reglas e inteligencia artificial.
        </li>
        <li>Prevenir fraude, abuso, accesos no autorizados e incidentes.</li>
        <li>Atender consultas, correcciones, reclamos y solicitudes.</li>
        <li>Cumplir obligaciones legales y conservar trazabilidad.</li>
      </ul>
    ),
  },
  {
    id: "autorizacion-finalidad",
    title: "4. Autorización, necesidad y finalidad",
    content: (
      <>
        <p>
          El envío del formulario requiere autorización expresa para tratar los
          datos con las finalidades informadas. La negativa impide completar la
          postulación porque AISA no podría recibirla ni evaluarla; no produce
          otras consecuencias fuera de ese proceso.
        </p>
        <p>
          AISA no venderá datos de candidatos ni los utilizará para fines ajenos
          e incompatibles sin una autorización o fundamento jurídico aplicable.
          Solo recopilará información pertinente y razonablemente necesaria.
        </p>
      </>
    ),
  },
  {
    id: "evaluacion-automatizada",
    title: "5. Evaluación asistida y revisión",
    content: (
      <p>
        Las respuestas y el currículo pueden procesarse mediante reglas y
        proveedores de inteligencia artificial para generar apoyo evaluativo.
        AISA conserva autoridad humana sobre la selección. La persona puede
        solicitar corrección de sus datos o revisión de un resultado mediante el
        contacto de privacidad, sujeto a verificación de identidad y a la etapa
        del proceso.
      </p>
    ),
  },
  {
    id: "datos-sensibles",
    title: "6. Datos sensibles y minimización",
    content: (
      <p>
        No se solicitan categorías sensibles que no sean necesarias para una
        finalidad legítima. La persona debe evitar incluir espontáneamente
        información médica, biométrica, religiosa, política, sexual, familiar u
        otra información íntima que no haya sido requerida. Si una plaza
        necesitara excepcionalmente un dato de especial protección, AISA deberá
        informar antes su necesidad, finalidad y medidas aplicables.
      </p>
    ),
  },
  {
    id: "proveedores-transferencias",
    title: "7. Proveedores, destinatarios y transferencias",
    content: (
      <p>
        AISA puede compartir únicamente los datos necesarios con personal
        autorizado y proveedores que apoyen infraestructura, almacenamiento,
        autenticación, correo, mensajería, seguridad, analítica o inteligencia
        artificial. La selección de proveedores debe considerar finalidad,
        confidencialidad, acceso limitado, medidas de seguridad y condiciones
        contractuales. Si el servicio implica tratamiento fuera de Guatemala, se
        aplicarán salvaguardas razonables y la normativa que corresponda.
      </p>
    ),
  },
  {
    id: "seguridad",
    title: "8. Seguridad y confidencialidad",
    content: (
      <p>
        AISA aplicará medidas técnicas y organizativas razonables para reducir
        riesgos de acceso, pérdida, alteración, destrucción, divulgación o uso
        no autorizado. Ningún sistema es infalible; los incidentes confirmados
        serán gestionados conforme a su naturaleza, impacto y obligaciones
        aplicables.
      </p>
    ),
  },
  {
    id: "conservacion",
    title: "9. Conservación y eliminación",
    content: (
      <p>
        Los datos se conservarán mientras sean necesarios para gestionar la
        plaza y durante el período posterior razonablemente requerido para
        auditoría, seguridad, atención de controversias u obligaciones legales.
        El plazo depende del tipo de registro y del estado del proceso. Cuando
        deje de existir una finalidad válida, la información deberá eliminarse,
        anonimizarse o bloquearse según corresponda.
      </p>
    ),
  },
  {
    id: "derechos-solicitudes",
    title: "10. Consultas y solicitudes de la persona",
    content: (
      <>
        <p>Según resulte jurídicamente procedente, puede solicitar:</p>
        <ul>
          <li>conocer la información mantenida y sus finalidades;</li>
          <li>corregir o actualizar información inexacta;</li>
          <li>plantear oposición, consulta o solicitud de eliminación;</li>
          <li>
            solicitar aclaración o revisión humana del proceso evaluativo.
          </li>
        </ul>
        <p>
          Las solicitudes se envían a{" "}
          <a href="mailto:adminit@aisa.com.gt">adminit@aisa.com.gt</a>. AISA
          puede pedir información proporcional para verificar identidad y
          proteger los datos frente a terceros.
        </p>
      </>
    ),
  },
  {
    id: "marco-referencia",
    title: "11. Marco de referencia",
    content: (
      <>
        <p>
          Este aviso se interpreta conforme a la normativa guatemalteca
          aplicable y adopta voluntariamente principios de información previa,
          finalidad, proporcionalidad, exactitud, seguridad y posibilidad de
          corrección. La Ley de Acceso a la Información Pública se cita como
          referencia de principios y no para afirmar que una empresa privada sea
          automáticamente sujeto obligado fuera de los supuestos legales.
        </p>
        <p>
          A septiembre de 2026 existen iniciativas legislativas generales sobre
          protección de datos todavía en discusión. Una reforma futura puede
          requerir actualizar este aviso y solicitar una nueva aceptación.
        </p>
      </>
    ),
  },
  {
    id: "cambios-aviso",
    title: "12. Cambios al aviso",
    content: (
      <p>
        La versión vigente permanecerá disponible en esta ruta. Los cambios
        sustanciales se comunicarán de forma razonable y, cuando sea necesario,
        se solicitará nuevamente autorización antes de aplicar nuevas
        finalidades.
      </p>
    ),
  },
];

function useLegalDocumentMetadata() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${DOCUMENT_TITLE} | Talento AISA`;

    const description = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]'
    );
    const previousDescription = description?.content;
    const descriptionNode = description ?? document.createElement("meta");
    if (!description) {
      descriptionNode.name = "description";
      document.head.append(descriptionNode);
    }
    descriptionNode.content = DOCUMENT_DESCRIPTION;

    const canonical = document.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]'
    );
    const previousCanonical = canonical?.href;
    const canonicalNode = canonical ?? document.createElement("link");
    if (!canonical) {
      canonicalNode.rel = "canonical";
      document.head.append(canonicalNode);
    }
    canonicalNode.href = new URL(
      PRIVACY_TERMS_PATH,
      window.location.origin
    ).href;

    return () => {
      document.title = previousTitle;
      if (description) description.content = previousDescription ?? "";
      else descriptionNode.remove();
      if (canonical) canonical.href = previousCanonical ?? "";
      else canonicalNode.remove();
    };
  }, []);
}

function SectionCard({ section }: { section: LegalSection }) {
  return (
    <section
      id={section.id}
      className="scroll-mt-28 rounded-2xl border border-border bg-card p-5 shadow-soft sm:p-7"
    >
      <h3 className="text-lg font-800 tracking-[-.02em] text-primary">
        {section.title}
      </h3>
      <div className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground [&_a]:font-semibold [&_a]:text-sky-700 [&_a]:underline [&_a]:underline-offset-4 dark:[&_a]:text-[#58a6ff] [&_li]:pl-1 [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
        {section.content}
      </div>
    </section>
  );
}

export default function PrivacyTerms() {
  useLegalDocumentMetadata();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur-xl print:static print:bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <AppBrand className="h-8 sm:h-9" />
          <div className="flex items-center gap-2 print:hidden">
            <ThemeToggle />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => window.print()}
            >
              <Printer className="mr-2 size-4" />
              <span className="hidden sm:inline">Imprimir o guardar</span>
              <span className="sm:hidden">Imprimir</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={() => window.close()}
              aria-label="Cerrar esta pestaña de referencia"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <section className="overflow-hidden rounded-[2rem] border border-border bg-card shadow-lift">
          <div className="bg-primary px-6 py-8 text-primary-foreground dark:bg-[#162333] sm:px-10 sm:py-11">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[.16em]">
              <span className="rounded-full border border-current/25 px-3 py-1">
                Documento vigente
              </span>
              <span>Versión {APPLICATION_CONSENT_VERSION}</span>
            </div>
            <h1 className="mt-5 max-w-4xl text-3xl font-800 leading-tight tracking-[-.045em] sm:text-5xl">
              {DOCUMENT_TITLE}
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 opacity-80 sm:text-base">
              Última actualización: 10 de septiembre de 2026. Este documento
              explica las reglas de uso, el tratamiento de datos y la
              intervención de herramientas de inteligencia artificial en Talento
              AISA.
            </p>
          </div>

          <div className="grid gap-3 p-5 sm:grid-cols-3 sm:p-7">
            <SummaryItem
              icon={UserRoundCheck}
              title="Decisión humana"
              text="La IA brinda apoyo; AISA conserva la decisión del proceso."
            />
            <SummaryItem
              icon={LockKeyhole}
              title="Finalidad limitada"
              text="Los datos se utilizan para selección, seguridad y trazabilidad."
            />
            <SummaryItem
              icon={ShieldCheck}
              title="Derecho de consulta y corrección"
              text="Usted puede solicitar información, actualización o revisión."
            />
          </div>
        </section>

        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950 print:hidden">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
          <p>
            El formulario permanece abierto en la pestaña anterior. Consulte
            este documento y vuelva a esa pestaña para completar su postulación.
          </p>
        </div>

        <div className="mt-8 grid items-start gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <nav
            aria-label="Contenido del documento"
            className="rounded-2xl border border-border bg-card p-4 lg:sticky lg:top-24 print:hidden"
          >
            <p className="text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">
              Contenido
            </p>
            <div className="mt-3 space-y-1 text-sm">
              <a
                href="#terminos"
                className="flex items-center gap-2 rounded-xl px-3 py-2 font-semibold hover:bg-accent/60"
              >
                <FileText className="size-4" /> Términos de uso
              </a>
              <a
                href="#privacidad"
                className="flex items-center gap-2 rounded-xl px-3 py-2 font-semibold hover:bg-accent/60"
              >
                <LockKeyhole className="size-4" /> Privacidad
              </a>
              <a
                href="#referencias"
                className="flex items-center gap-2 rounded-xl px-3 py-2 font-semibold hover:bg-accent/60"
              >
                <ExternalLink className="size-4" /> Referencias
              </a>
              <a
                href="mailto:adminit@aisa.com.gt"
                className="flex items-center gap-2 rounded-xl px-3 py-2 font-semibold hover:bg-accent/60"
              >
                <Mail className="size-4" /> Contactar a AISA
              </a>
            </div>
          </nav>

          <div className="min-w-0 space-y-10">
            <article id="terminos" className="scroll-mt-24">
              <SectionHeading
                icon={FileText}
                eyebrow="Parte I"
                title="Términos y condiciones de uso"
                description="Reglas aplicables al acceso, postulación y utilización responsable de Talento AISA."
              />
              <div className="mt-5 space-y-4">
                {termsSections.map(section => (
                  <SectionCard key={section.id} section={section} />
                ))}
              </div>
            </article>

            <article id="privacidad" className="scroll-mt-24">
              <SectionHeading
                icon={LockKeyhole}
                eyebrow="Parte II"
                title="Aviso de privacidad y tratamiento de datos personales"
                description="Información sobre datos recopilados, finalidades, IA, seguridad, conservación y solicitudes."
              />
              <div className="mt-5 space-y-4">
                {privacySections.map(section => (
                  <SectionCard key={section.id} section={section} />
                ))}
              </div>
            </article>

            <section
              id="referencias"
              className="scroll-mt-24 rounded-2xl border border-border bg-secondary/45 p-5 sm:p-7"
            >
              <div className="flex items-center gap-3">
                <Bot className="size-5 text-violet-700 dark:text-[#a78bfa]" />
                <h2 className="text-xl font-800 text-primary">
                  Referencias normativas oficiales
                </h2>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Estas referencias orientan la redacción y no constituyen una
                certificación ni sustituyen asesoría jurídica especializada.
              </p>
              <ul className="mt-4 space-y-2 text-sm font-semibold text-sky-700 dark:text-[#58a6ff]">
                <li>
                  <a
                    href="https://www.congreso.gob.gt/detalle_pdf/decretos/13076"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4"
                  >
                    Decreto 47-2008 · Comunicaciones y firmas electrónicas
                  </a>
                </li>
                <li>
                  <a
                    href="https://diaco.gob.gt/ley_proteccion_al_usuario/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4"
                  >
                    Decreto 06-2003 · Protección al Consumidor y Usuario
                  </a>
                </li>
                <li>
                  <a
                    href="https://www.congreso.gob.gt/detalle_pdf/decretos/13082"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4"
                  >
                    Decreto 57-2008 · Ley de Acceso a la Información Pública
                  </a>
                </li>
                <li>
                  <a
                    href="https://www.congreso.gob.gt/noticias_congreso/16492/2026/3"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4"
                  >
                    Congreso · Estado de discusión sobre protección de datos
                  </a>
                </li>
              </ul>
            </section>
          </div>
        </div>
      </div>

      <footer className="border-t border-border bg-card px-4 py-6 text-center text-xs leading-5 text-muted-foreground sm:px-6">
        Todos los derechos reservados por Alternativas Inteligentes, S.A. ·
        Talento AISA · Aviso {APPLICATION_CONSENT_VERSION}
      </footer>
    </main>
  );
}

function SummaryItem({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof ShieldCheck;
  title: string;
  text: string;
}) {
  return (
    <div className="flex gap-3 rounded-2xl bg-secondary/55 p-4">
      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-card text-emerald-700 dark:text-[#35d6b1]">
        <Icon className="size-5" />
      </div>
      <div>
        <h2 className="text-sm font-800 text-primary">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

function SectionHeading({
  icon: Icon,
  eyebrow,
  title,
  description,
}: {
  icon: typeof ShieldCheck;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">
        <Icon className="size-5" />
      </div>
      <div>
        <p className="text-xs font-bold uppercase tracking-[.16em] text-emerald-700 dark:text-[#35d6b1]">
          {eyebrow}
        </p>
        <h2 className="mt-1 text-2xl font-800 tracking-[-.035em] text-primary sm:text-3xl">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}
