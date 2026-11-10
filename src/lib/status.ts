export type ClientStatus = "lead" | "active" | "lost";

export const STATUS_OPTIONS: { value: ClientStatus; label: string }[] = [
  { value: "lead", label: "Lead" },
  { value: "active", label: "Active" },
  { value: "lost", label: "Lost" },
];

export const STATUS_LABEL: Record<ClientStatus, string> = {
  lead: "Lead",
  active: "Active",
  lost: "Lost",
};
