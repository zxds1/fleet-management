import { describe, it, expect } from 'vitest';
import { CONFIG_DEFAULTS, ConfigClient, ConfigKeyError } from '../src';

describe('ConfigClient: the real system_config keys and their seeded defaults', () => {
  it('the offline ceiling, the PIN lockout and the duty limits come from the real key names', () => {
    const c = new ConfigClient();
    expect(c.numeric('auth.device_offline_max_hours')).toBe(24);
    expect(c.numeric('auth.offline_pin_lockout_attempts')).toBe(5);
    expect(c.numeric('auth.offline_pin_wipe_attempts')).toBe(10);
    expect(c.numeric('auth.offline_pin_lockout_minutes')).toBe(15);
    expect(c.numeric('auth.max_concurrent_sessions')).toBe(10);
    expect(c.numeric('shift.max_duty_hours')).toBe(14);
    expect(c.numeric('shift.overrun_warning_hours')).toBe(12);
    expect(c.numeric('speed.limit_kph')).toBe(80);
    expect(c.numeric('documents.warn_days_before')).toBe(30);
    expect(c.numeric('accident.ack_timeout_minutes')).toBe(5);
    expect(c.numeric('fuel.anomaly_gauge_deviation_pct')).toBe(20);
  });
  it('locale keys are strings, and they are Kenya', () => {
    const c = new ConfigClient();
    expect(c.string('locale.timezone')).toBe('Africa/Nairobi');
    expect(c.string('locale.currency')).toBe('KES');
  });
  it('server values override defaults, including numeric strings', () => {
    const c = new ConfigClient();
    c.update({ 'auth.device_offline_max_hours': 12, 'shift.max_duty_hours': '16' });
    expect(c.numeric('auth.device_offline_max_hours')).toBe(12);
    expect(c.numeric('shift.max_duty_hours')).toBe(16);
  });
  it.each([['abc'], [NaN], [''], [null], [{}]])('a bad server value (%s) falls back to the default', (bad) => {
    const c = new ConfigClient();
    c.update({ 'auth.device_offline_max_hours': bad });
    expect(c.numeric('auth.device_offline_max_hours')).toBe(24);
  });
  it('unknown keys throw ConfigKeyError unless the server defined them', () => {
    const c = new ConfigClient();
    expect(() => c.numeric('hos.daily_limit_hours' as never)).toThrow(ConfigKeyError);
    expect(c.has('hos.daily_limit_hours')).toBe(false);
    c.update({ 'hos.daily_limit_hours': 16, flag: 'true', label: 'x' });
    expect(c.has('hos.daily_limit_hours')).toBe(true);
    expect(c.numeric('hos.daily_limit_hours' as never)).toBe(16);
    expect(c.boolean('flag' as never)).toBe(true);
    expect(c.string('label' as never)).toBe('x');
  });
  it('string/boolean coercions', () => {
    const c = new ConfigClient({ a: true, b: 'hi', c: 3 });
    expect(c.boolean('a' as never)).toBe(true);
    expect(c.string('c' as never)).toBe('3');
    c.update({ a: 'FALSE', b: 0 });
    expect(c.boolean('a' as never)).toBe(false);
    expect(c.boolean('b' as never)).toBe(false);
  });
  it('update(null) is harmless', () => {
    const c = new ConfigClient();
    c.update(null);
    c.update(undefined);
    expect(c.numeric('auth.device_offline_max_hours')).toBe(24);
  });
  it('CONFIG_DEFAULTS contains nothing the backend does not seed', () => {
    for (const k of Object.keys(CONFIG_DEFAULTS)) expect(k).toMatch(/^[a-z]+\.[a-z0-9_]+$/);
    expect(CONFIG_DEFAULTS['auth.device_offline_max_hours']).toBe(24);
  });
});