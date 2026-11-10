export type Role = "admin" | "member";

/**
 * What each role may do in the app. The database enforces the same rules;
 * this map only decides which buttons and pages to show.
 */
export const permissions = {
  addClients: (role: Role) => role === "admin" || role === "member",
  editClients: (role: Role) => role === "admin" || role === "member",
  uploadDocuments: (role: Role) => role === "admin" || role === "member",
  exportClients: (role: Role) => role === "admin" || role === "member",
  deleteClients: (role: Role) => role === "admin",
  inviteMembers: (role: Role) => role === "admin",
  viewCompanySettings: (role: Role) => role === "admin",
} as const;
