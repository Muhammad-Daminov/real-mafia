import { resolveDevToolsImports } from './dev-tools.config';
import { DevToolsModule } from './dev-tools.module';

describe('resolveDevToolsImports', () => {
  const originalEnabled = process.env.DEV_TOOLS_ENABLED;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalEnabled === undefined) {
      delete process.env.DEV_TOOLS_ENABLED;
    } else {
      process.env.DEV_TOOLS_ENABLED = originalEnabled;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('returns [] when DEV_TOOLS_ENABLED is unset, regardless of NODE_ENV', () => {
    delete process.env.DEV_TOOLS_ENABLED;
    process.env.NODE_ENV = 'development';
    expect(resolveDevToolsImports()).toEqual([]);

    process.env.NODE_ENV = 'test';
    expect(resolveDevToolsImports()).toEqual([]);
  });

  it('returns [] when DEV_TOOLS_ENABLED is set to something other than the literal "true"', () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_TOOLS_ENABLED = '1';
    expect(resolveDevToolsImports()).toEqual([]);

    process.env.DEV_TOOLS_ENABLED = 'TRUE';
    expect(resolveDevToolsImports()).toEqual([]);
  });

  it('returns [DevToolsModule] when DEV_TOOLS_ENABLED === "true" and NODE_ENV is not production', () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_TOOLS_ENABLED = 'true';
    expect(resolveDevToolsImports()).toEqual([DevToolsModule]);
  });

  it('throws (fails fast) when NODE_ENV=production and DEV_TOOLS_ENABLED is set to "true"', () => {
    process.env.NODE_ENV = 'production';
    process.env.DEV_TOOLS_ENABLED = 'true';
    expect(() => resolveDevToolsImports()).toThrow(/DEV_TOOLS_ENABLED/);
  });

  it('throws even when DEV_TOOLS_ENABLED is set to a falsy-looking value in production ("is set" is the trigger, not the value)', () => {
    process.env.NODE_ENV = 'production';
    process.env.DEV_TOOLS_ENABLED = 'false';
    expect(() => resolveDevToolsImports()).toThrow(/DEV_TOOLS_ENABLED/);
  });

  it('does not throw in production when DEV_TOOLS_ENABLED is unset', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DEV_TOOLS_ENABLED;
    expect(() => resolveDevToolsImports()).not.toThrow();
    expect(resolveDevToolsImports()).toEqual([]);
  });
});
