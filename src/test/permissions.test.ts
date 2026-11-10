import { describe, expect, it } from "vitest";
import { permissions } from "@/lib/permissions";

describe("role permissions", () => {
  it("only admins can invite members", () => {
    expect(permissions.inviteMembers("admin")).toBe(true);
    expect(permissions.inviteMembers("member")).toBe(false);
  });

  it("only admins can delete clients", () => {
    expect(permissions.deleteClients("admin")).toBe(true);
    expect(permissions.deleteClients("member")).toBe(false);
  });

  it("only admins see company settings", () => {
    expect(permissions.viewCompanySettings("admin")).toBe(true);
    expect(permissions.viewCompanySettings("member")).toBe(false);
  });

  it("members can add and edit clients", () => {
    expect(permissions.addClients("member")).toBe(true);
    expect(permissions.editClients("member")).toBe(true);
  });
});
