import { describe, expect, it } from "vitest";

import {
  assertStagingFixtureEnvironment,
  UI_FIXTURE_PRODUCTION_PROJECT_REFS,
  UI_FIXTURE_STAGING_PROJECT_REF,
} from "@/test-support/staging-fixture-safety";

const stagingUrl = `https://${UI_FIXTURE_STAGING_PROJECT_REF}.supabase.co`;
const productionRef = [...UI_FIXTURE_PRODUCTION_PROJECT_REFS][0] as string;

describe("staging UI fixture safety", () => {
  it("accepts only the exact staging project", () => {
    expect(
      assertStagingFixtureEnvironment({
        expectedProjectRef: UI_FIXTURE_STAGING_PROJECT_REF,
        supabaseUrl: stagingUrl,
        vercelEnvironment: "preview",
      }),
    ).toBe(UI_FIXTURE_STAGING_PROJECT_REF);
  });

  it("rejects production even when expected ref is changed to production", () => {
    expect(() =>
      assertStagingFixtureEnvironment({
        expectedProjectRef: productionRef,
        supabaseUrl: `https://${productionRef}.supabase.co`,
        vercelEnvironment: "preview",
      }),
    ).toThrow(/운영 Supabase/);
  });

  it("rejects a production deployment and a different preview project", () => {
    expect(() =>
      assertStagingFixtureEnvironment({
        expectedProjectRef: UI_FIXTURE_STAGING_PROJECT_REF,
        supabaseUrl: stagingUrl,
        vercelEnvironment: "production",
      }),
    ).toThrow(/Production 환경/);

    expect(() =>
      assertStagingFixtureEnvironment({
        expectedProjectRef: UI_FIXTURE_STAGING_PROJECT_REF,
        supabaseUrl: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
        vercelEnvironment: "preview",
      }),
    ).toThrow();
  });
});
