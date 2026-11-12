// Tests de la double authentification : vecteurs de la RFC 6238 (SHA-1), tolérance d'une période, base32.
import { describe, expect, it } from "vitest";
import { adresseTotp, codeTotp, depuisBase32, genererSecretTotp, verifierTotp, versBase32 } from "../src/totp";

/** Secret de la RFC 6238 (« 12345678901234567890 ») en base32. */
const SECRET = versBase32(Buffer.from("12345678901234567890"));

describe("TOTP", () => {
  it("donne les codes de la RFC 6238", () => {
    expect(codeTotp(SECRET, 59_000)).toBe("287082");
    expect(codeTotp(SECRET, 1111111109_000)).toBe("081804");
    expect(codeTotp(SECRET, 1234567890_000)).toBe("005924");
    expect(codeTotp(SECRET, 2000000000_000)).toBe("279037");
  });
  it("accepte une période de décalage, pas deux", () => {
    const t = 1234567890_000;
    expect(verifierTotp(SECRET, codeTotp(SECRET, t - 30_000), t)).toBe(true);
    expect(verifierTotp(SECRET, codeTotp(SECRET, t + 30_000), t)).toBe(true);
    expect(verifierTotp(SECRET, codeTotp(SECRET, t + 90_000), t)).toBe(false);
    expect(verifierTotp(SECRET, "12345", t)).toBe(false);
  });
  it("encode et décode le base32, et fabrique l'adresse otpauth", () => {
    const s = genererSecretTotp();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(versBase32(depuisBase32(s))).toBe(s);
    expect(adresseTotp(s, "moi@exemple.fr")).toContain(`secret=${s}`);
  });
});
