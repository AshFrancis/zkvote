import { describe, it, expect } from "vitest";
import {
  truncateAddress,
  truncateText,
  isUserRejection,
  isAccountNotFoundError,
  toSlug,
  toIdSlug,
  parseIdFromSlug,
  cn,
} from "./utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    expect(cn("foo", false && "bar", "baz")).toBe("foo baz");
  });

  it("merges Tailwind classes correctly", () => {
    expect(cn("p-4", "p-2")).toBe("p-2"); // tailwind-merge dedupes
  });
});

describe("truncateAddress", () => {
  it("truncates a long address", () => {
    const address = "GDXYZ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
    expect(truncateAddress(address)).toBe("GDXY...7890");
  });

  it("returns short addresses unchanged", () => {
    const address = "GDXYZ12";
    expect(truncateAddress(address)).toBe("GDXYZ12");
  });

  it("handles custom character counts", () => {
    const address = "GDXYZ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
    expect(truncateAddress(address, 6, 6)).toBe("GDXYZ1...567890");
  });

  it("handles empty string", () => {
    expect(truncateAddress("")).toBe("");
  });
});

describe("truncateText", () => {
  it("truncates long text", () => {
    const text = "This is a very long text that should be truncated";
    expect(truncateText(text, 20)).toBe("This is a very long ...");
  });

  it("returns short text unchanged", () => {
    const text = "Short";
    expect(truncateText(text, 20)).toBe("Short");
  });

  it("uses default max length of 30", () => {
    const text = "This text is exactly thirty one characters";
    expect(truncateText(text)).toBe("This text is exactly thirty on...");
  });

  it("handles empty string", () => {
    expect(truncateText("")).toBe("");
  });
});

describe("isUserRejection", () => {
  it("returns true for code -4", () => {
    expect(isUserRejection({ code: -4 })).toBe(true);
  });

  it("returns true for User rejected message", () => {
    expect(isUserRejection({ message: "User rejected the request" })).toBe(true);
  });

  it("returns true for declined message", () => {
    expect(isUserRejection({ message: "Request was declined" })).toBe(true);
  });

  it("returns true for cancelled message", () => {
    expect(isUserRejection({ message: "User cancelled" })).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isUserRejection({ message: "Network error" })).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isUserRejection(null)).toBe(false);
    expect(isUserRejection(undefined)).toBe(false);
  });
});

describe("isAccountNotFoundError", () => {
  it("returns true for Account not found message", () => {
    expect(isAccountNotFoundError(new Error("Account not found"))).toBe(true);
  });

  it("returns true for does not exist message", () => {
    expect(isAccountNotFoundError(new Error("The account does not exist"))).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isAccountNotFoundError(new Error("Network error"))).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isAccountNotFoundError(null)).toBe(false);
  });
});

describe("toSlug", () => {
  it("converts text to lowercase", () => {
    expect(toSlug("Hello World")).toBe("hello-world");
  });

  it("replaces spaces with hyphens", () => {
    expect(toSlug("my dao name")).toBe("my-dao-name");
  });

  it("removes special characters", () => {
    expect(toSlug("Test! @DAO #123")).toBe("test-dao-123");
  });

  it("handles multiple spaces", () => {
    expect(toSlug("too   many   spaces")).toBe("too-many-spaces");
  });

  it("trims whitespace", () => {
    expect(toSlug("  trimmed  ")).toBe("trimmed");
  });
});

describe("toIdSlug", () => {
  it("combines ID and slugified name", () => {
    expect(toIdSlug(1, "Test DAO")).toBe("1-test-dao");
  });

  it("returns just ID if name produces empty slug", () => {
    expect(toIdSlug(42, "!!!")).toBe("42");
  });
});

describe("parseIdFromSlug", () => {
  it("extracts ID from ID-slug format", () => {
    expect(parseIdFromSlug("1-test-dao")).toBe(1);
  });

  it("extracts ID when no slug present", () => {
    expect(parseIdFromSlug("42")).toBe(42);
  });

  it("returns null for invalid format", () => {
    expect(parseIdFromSlug("not-a-number")).toBe(null);
  });

  it("handles larger IDs", () => {
    expect(parseIdFromSlug("12345-my-org")).toBe(12345);
  });
});
