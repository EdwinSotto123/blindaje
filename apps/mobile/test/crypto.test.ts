import { webcrypto } from "node:crypto";

import { p256 } from "@noble/curves/nist.js";

import { equalBytes, fromHex, fromUtf8, toBase64Url, toHex, utf8 } from "@/lib/bytes";
import { ivOf, open, seal } from "@/security/aead";
import { publicJwkFromSecret, generateDeviceSecret, refreshMessage, signRefresh } from "@/security/device";
import { sha256Hex } from "@/security/hash";
import { checkPin, createPinRecord } from "@/security/pin";
import { randomBytes } from "@/security/random";

describe("AES-256-GCM de la cola local", () => {
  const key = randomBytes(32);

  it("cifra y descifra ida y vuelta", () => {
    const msg = utf8("Si no yapeas S/ 2,000 en 48 horas… (mensaje ficticio)");
    const sealed = seal(key, msg);
    expect(equalBytes(sealed, msg)).toBe(false);
    expect(fromUtf8(open(key, sealed))).toBe("Si no yapeas S/ 2,000 en 48 horas… (mensaje ficticio)");
  });

  it("usa un IV distinto en cada cifrado", () => {
    const msg = utf8("mismo contenido");
    const ivs = new Set<string>();
    const cts = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const s = seal(key, msg);
      ivs.add(toHex(ivOf(s)));
      cts.add(toHex(s));
    }
    expect(ivs.size).toBe(500);
    expect(cts.size).toBe(500);
  });

  it("detecta manipulación, llave equivocada y AAD distinto", () => {
    const sealed = seal(key, utf8("hola"), utf8("q1"));
    const tampered = sealed.slice();
    tampered[tampered.length - 1]! ^= 1;
    expect(() => open(key, tampered, utf8("q1"))).toThrow();
    expect(() => open(randomBytes(32), sealed, utf8("q1"))).toThrow();
    expect(() => open(key, sealed, utf8("q2"))).toThrow();
    expect(fromUtf8(open(key, sealed, utf8("q1")))).toBe("hola");
  });

  it("rechaza llaves que no son de 256 bits", () => {
    expect(() => seal(randomBytes(16), utf8("x"))).toThrow();
  });

  it("interopera con WebCrypto (lo que usa el Worker)", async () => {
    const msg = utf8("archivo de prueba");
    const sealed = seal(key, msg);
    const k = await webcrypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
    const plain = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: ivOf(sealed) }, k, sealed.slice(13));
    expect(fromUtf8(new Uint8Array(plain))).toBe("archivo de prueba");
  });
});

describe("SHA-256", () => {
  it("coincide con el vector conocido", () => {
    expect(sha256Hex(utf8("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("PIN y PIN señuelo", () => {
  it("distingue PIN real, señuelo e incorrecto", async () => {
    const rec = await createPinRecord("4826", "1357", 1000);
    expect(rec.real).not.toContain("4826");
    expect(await checkPin(rec, "4826")).toBe("real");
    expect(await checkPin(rec, "1357")).toBe("decoy");
    expect(await checkPin(rec, "0000")).toBeNull();
    expect(await checkPin(rec, "12")).toBeNull();
    expect(await checkPin(null, "4826")).toBeNull();
  });

  it("no acepta un señuelo igual al PIN", async () => {
    await expect(createPinRecord("4826", "4826", 1000)).rejects.toThrow();
  });
});

describe("Llave del dispositivo (P-256)", () => {
  it("exporta la pública como JWK y firma en formato IEEE P1363 verificable por WebCrypto", async () => {
    const secret = generateDeviceSecret();
    const jwk = publicJwkFromSecret(secret);
    expect(jwk).toMatchObject({ kty: "EC", crv: "P-256" });
    const sigB64 = signRefresh(secret, "dev_1", 1_761_600_000_000);
    const sig = Uint8Array.from(Buffer.from(sigB64.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
    expect(sig.length).toBe(64);
    const pub = await webcrypto.subtle.importKey("jwk", { ...jwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, sig, utf8(refreshMessage("dev_1", 1_761_600_000_000)));
    expect(ok).toBe(true);
    expect(p256.verify(sig, utf8(refreshMessage("dev_1", 1_761_600_000_000)), p256.getPublicKey(secret))).toBe(true);
  });

  it("base64url sin relleno y hex ida y vuelta", () => {
    const b = randomBytes(33);
    expect(toBase64Url(b)).not.toMatch(/[+/=]/);
    expect(toHex(fromHex(toHex(b)))).toBe(toHex(b));
  });
});
