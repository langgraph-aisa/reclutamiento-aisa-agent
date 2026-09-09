import {
  APPLICATION_STATUS_VALUES,
  type ApplicationStatus,
} from "../shared/applicationStatus";

export const applicationStatuses = APPLICATION_STATUS_VALUES;
export type { ApplicationStatus };
export type RecruitmentRole = "user" | "reclutador" | "admin";

export function canOperateCandidates(role: RecruitmentRole) {
  return role === "reclutador" || role === "admin";
}
export function canManageConfiguration(role: RecruitmentRole) {
  return role === "admin";
}
export function shouldContinueAfterReview(status: string) {
  return status === "calificado";
}
export function duplicateIdentity(
  phoneInternational: string,
  positionId: number
) {
  return `${phoneInternational}:${positionId}`;
}
export function canChangeStatus(role: RecruitmentRole, nextStatus: string) {
  return (
    canOperateCandidates(role) &&
    applicationStatuses.includes(nextStatus as ApplicationStatus)
  );
}
