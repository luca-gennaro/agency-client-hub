import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/csv";

describe("client CSV export", () => {
  it("quotes cells containing commas, quotes and newlines", () => {
    expect(csvCell('Acme, "Inc"')).toBe('"Acme, ""Inc"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("keeps phone numbers that start with + intact", () => {
    expect(csvCell("+39 333 123 4567")).toBe("+39 333 123 4567");
  });

  it("neutralises spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
  });

  it("joins header and rows with CRLF", () => {
    expect(toCsv(["Name", "Status"], [["Ada", "Lead"]])).toBe("Name,Status\r\nAda,Lead");
  });
});
