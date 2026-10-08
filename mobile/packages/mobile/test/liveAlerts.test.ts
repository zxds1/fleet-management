import { describe, it, expect } from 'vitest';
import { alertFromEvent } from '../src/core/liveAlerts';
const id = '11111111-1111-4111-8111-111111111111';
describe('live alerts from socket events', () => {
  it('a mayday on the admin channel becomes a MAYDAY banner', () => expect(alertFromEvent('accident:live', { accident_id: id, mayday: true })).toEqual({ kind: 'MAYDAY', accidentId: id }));
  it.each([[{ accident_id: id }], [{ accident_id: id, mayday: 'true' }], [{ mayday: true }], [{ accident_id: 'x', mayday: true }], [null], ['str'], [undefined]])('ignores %j', (p) => expect(alertFromEvent('accident:live', p)).toBeNull());
  it('a driver accident status update becomes a short, sanitised message', () => {
    expect(alertFromEvent('driver:accident', { accident_id: id, escalation_status: 'TIER_2_ESCALATED' })).toEqual({ kind: 'ACCIDENT_UPDATE', text: 'tier 2 escalated', accidentId: id });
    const long = alertFromEvent('driver:accident', { escalation_status: 'x'.repeat(500) }); expect(long && 'text' in long && long.text.length).toBe(40);
  });
  it('an invalid accident id on a driver update is dropped but the status still shows', () => expect(alertFromEvent('driver:accident', { accident_id: 'bad', escalation_status: 'ACKNOWLEDGED' })).toEqual({ kind: 'ACCIDENT_UPDATE', text: 'acknowledged', accidentId: undefined }));
  it('other channels and empty statuses never raise a banner', () => {
    expect(alertFromEvent('notifications', { mayday: true, accident_id: id })).toBeNull();
    expect(alertFromEvent('map:vehicle-states', { mayday: true, accident_id: id })).toBeNull();
    expect(alertFromEvent('driver:accident', { escalation_status: '  ' })).toBeNull();
  });
  it('a driver-scoped update also accepts id/status/escalation_tier, because the producer forwards whatever it published', () => {
    expect(alertFromEvent('driver:accident', { id, status: 'ACKNOWLEDGED' })).toEqual({ kind: 'ACCIDENT_UPDATE', text: 'acknowledged', accidentId: id });
    expect(alertFromEvent('driver:accident', { accident_id: id, escalation_tier: 3 })).toEqual({ kind: 'ACCIDENT_UPDATE', text: 'tier 3', accidentId: id });
  });
});
