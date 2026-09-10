export const APPLICATION_CONSENT_VERSION = "2026-09-10.2";
export const PRIVACY_TERMS_PATH = "/privacidad-terminos";
export const PRIVACY_TERMS_LINK_TEXT =
  '"Privacidad, términos y condiciones de uso"';

export const APPLICATION_CONSENTS = [
  {
    id: "adultConfirmed",
    text: "Confirmo que soy mayor de 18 años.",
  },
  {
    id: "informationTruthful",
    text: "Declaro que la información proporcionada es verdadera, exacta, completa y actualizada.",
  },
  {
    id: "privacyAccepted",
    text: `He leído el Aviso de ${PRIVACY_TERMS_LINK_TEXT} y autorizo a AISA a tratar mis datos para fines relacionados con este proceso de selección.`,
  },
] as const;

export type ApplicationConsentId = (typeof APPLICATION_CONSENTS)[number]["id"];

export type ApplicationConsents = Record<ApplicationConsentId, boolean>;

export const EMPTY_APPLICATION_CONSENTS: ApplicationConsents = {
  adultConfirmed: false,
  informationTruthful: false,
  privacyAccepted: false,
};
