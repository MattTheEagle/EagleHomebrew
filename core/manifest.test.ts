/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import packageRaw from "../package.json?raw";
import manifestRaw from "../v13/module.json?raw";
import { FLIGHT_CONTROL_ID, FLIGHT_CONTROL_MIN_MODULE_VERSION } from "./flight-control";
import { HOMEBREW_ID } from "./index";

// The manifest is what Foundry installs from, so the release files must agree with it. `npm run package` checks the
// same rules again when it builds the release.
interface Manifest {
  id: string;
  title: string;
  description: string;
  version: string;
  authors: { name: string }[];
  compatibility: { minimum: string; verified: string };
  relationships?: { requires?: { id: string; type: string; compatibility: { minimum: string } }[] };
  esmodules: string[];
  languages?: { lang: string; name: string; path: string }[];
  styles?: string[];
}

interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

const manifest = JSON.parse(manifestRaw) as Manifest;
const pack = JSON.parse(packageRaw) as PackageJson;

const LIBRARY_ID = "eagle-library";
const LIBRARY_MIN_MODULE_VERSION = "0.1.0";

describe("module manifest", () => {
  it("names the module and gives it a release version", () => {
    expect(manifest.id).toBe(HOMEBREW_ID);
    expect(manifest.title).toBe("Eagle Homebrew");
    expect(manifest.version).toMatch(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  });

  it("loads the bundle, which is the file of the release", () => {
    expect(manifest.esmodules).toEqual(["dist/module.js"]);
  });

  it("is written for Foundry 13 only", () => {
    expect(manifest.compatibility).toEqual({ minimum: "13", verified: "13" });
  });

  it("requires Flight Control and the Library, each from the release it was written against", () => {
    // Contract of Flight Control, section 6; Homebrew is the second real consumer of the Library (M1 Apply, decision 4).
    expect(manifest.relationships?.requires).toEqual([
      { id: FLIGHT_CONTROL_ID, type: "module", compatibility: { minimum: FLIGHT_CONTROL_MIN_MODULE_VERSION } },
      { id: LIBRARY_ID, type: "module", compatibility: { minimum: LIBRARY_MIN_MODULE_VERSION } },
    ]);
  });

  it("names no address and no download, because there is no repository", () => {
    for (const field of ["url", "bugs", "manifest", "download"]) {
      expect(manifest, field).not.toHaveProperty(field);
    }
  });

  it("names the English language file, since M4 has visible text (the homebrew window)", () => {
    expect(manifest.languages).toEqual([{ lang: "en", name: "English", path: "lang/en.json" }]);
  });

  it("names the Homebrew stylesheet, added in M7 to make the window's own content scroll", () => {
    expect(manifest.styles).toEqual(["styles/eagle-homebrew.css"]);
  });

  it("has no placeholder text left", () => {
    expect(manifest.authors.length).toBeGreaterThan(0);
    for (const author of manifest.authors) {
      expect(author.name.trim()).not.toBe("");
      expect(author.name.toLowerCase()).not.toBe("projektleiter");
    }
    expect(manifest.description.trim()).not.toBe("");
    expect(manifest.description).not.toMatch(/in entwicklung/i);
  });
});

describe("package.json", () => {
  it("has the id and the version of the manifest", () => {
    expect(pack.name).toBe(manifest.id);
    expect(pack.version).toBe(manifest.version);
  });

  it("stays private, adds no dependency and offers the package script", () => {
    expect(pack.private).toBe(true);
    expect(pack.dependencies).toBeUndefined();
    expect(Object.keys(pack.devDependencies ?? {}).sort()).toEqual(["esbuild", "typescript", "vitest"]);
    expect(pack.scripts?.package).toBe("node v13/package.mjs");
  });
});
