// Lifecycle e-mails of the runner, pure rules (druid-internal docs/plan-druid-saas.md, lot 6 d): what failed and where
// to start it again, the reason shown (secrets masked), when a tenant is inactive and when it is told again, the hours
// of the notices, and the two e-mails as Resend receives them.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { failureReason, inNoticeHours, isInactivityDue, jobLabelOf, jobPagePath, lastActivityOf } from '../saas/notices';
import { sendInactivityNotice, sendJobFailed } from '../saas/email';

describe('failed job', () => {
  it('names the job and the page where it is started again', () => {
    expect(jobLabelOf({ type: 'etl.build', params: {} })[0]).toBe('La construction des tableaux de bord');
    expect(jobLabelOf({ type: 'people.align', params: { source: 'orcid' } })).toEqual(["L'alignement des chercheurs (ORCID)", 'The alignment of the researchers (ORCID)']);
    expect(jobLabelOf({ type: 'people.align', params: {} })[1]).toBe('The alignment of the researchers');
    expect(jobPagePath('tenant.export')).toBe('/?page=ADMIN&tab=establishment');
    expect(jobPagePath('etl.build')).toBe('/?page=UNIFIED_ALIGN');
  });

  it('shows the last line of the error, secrets masked, 300 characters at most', () => {
    expect(failureReason('child 1: etl\nHTTPError 403 for https://api.example.org/works?api_key=SECRET123&page=2\n')).toBe('HTTPError 403 for https://api.example.org/works?api_key=***&page=2');
    expect(failureReason('x'.repeat(400))).toHaveLength(300);
    expect(failureReason('')).toBe('');
  });
});

describe('inactivity', () => {
  const now = new Date('2026-11-10T10:00:00Z');
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

  it('counts from the last sign-in, or from the creation when nobody signed in', () => {
    expect(lastActivityOf({ created_at: daysAgo(200), last_login: daysAgo(10) }).toISOString()).toBe(daysAgo(10));
    expect(lastActivityOf({ created_at: daysAgo(200), last_login: null }).toISOString()).toBe(daysAgo(200));
  });

  it('is due after 90 days, once per inactive spell', () => {
    expect(isInactivityDue({ created_at: daysAgo(200), last_login: daysAgo(89), inactivity_notified_at: null }, now)).toBe(false);
    expect(isInactivityDue({ created_at: daysAgo(200), last_login: daysAgo(91), inactivity_notified_at: null }, now)).toBe(true);
    // Told after that sign-in: not again.
    expect(isInactivityDue({ created_at: daysAgo(200), last_login: daysAgo(120), inactivity_notified_at: daysAgo(25) }, now)).toBe(false);
    // Told, signed in again later, inactive again: told again.
    expect(isInactivityDue({ created_at: daysAgo(300), last_login: daysAgo(95), inactivity_notified_at: daysAgo(150) }, now)).toBe(true);
  });

  it('sends in office hours (UTC) only', () => {
    expect(inNoticeHours(new Date('2026-11-10T07:00:00Z'))).toBe(true);
    expect(inNoticeHours(new Date('2026-11-10T16:59:00Z'))).toBe(true);
    expect(inNoticeHours(new Date('2026-11-10T17:00:00Z'))).toBe(false);
    expect(inNoticeHours(new Date('2026-11-10T03:00:00Z'))).toBe(false);
  });
});

describe('e-mails', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const capture = () => {
    const sent: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: any) => { sent.push(JSON.parse(init.body)); return new Response('{}'); }));
    return sent;
  };

  it('tells what failed, why, and whether the scheduler retries it', async () => {
    const sent = capture();
    await sendJobFailed({ RESEND_API_KEY: 'k' }, { to: 'owner@example.org', label: 'Univ <A>', what: jobLabelOf({ type: 'etl.build', params: {} }), reason: 'every lab failed: ls2n', pageUrl: 'https://a.example.org/?page=UNIFIED_ALIGN', retried: true });
    expect(sent[0].subject).toBe('Échec : la construction des tableaux de bord · Failed: the build of the dashboards (Univ <A>)');
    expect(sent[0].html).toContain('every lab failed: ls2n');
    expect(sent[0].html).toContain('Univ &lt;A&gt;');
    expect(sent[0].html).toContain('la nuit prochaine');
    expect(sent[0].text).toContain('https://a.example.org/?page=UNIFIED_ALIGN');
  });

  it('dates the last activity and points to the sign-in and to « My institution »', async () => {
    const sent = capture();
    await sendInactivityNotice({ RESEND_API_KEY: 'k' }, { to: 'owner@example.org', label: 'Univ A', lastActivity: '2026-08-01T10:00:00Z', loginUrl: 'https://a.example.org/auth/login', adminUrl: 'https://a.example.org/?page=ADMIN&tab=establishment' });
    expect(sent[0].to).toBe('owner@example.org');
    expect(sent[0].html).toContain('1 août 2026');
    expect(sent[0].html).toContain('1 August 2026');
    expect(sent[0].text).toContain('https://a.example.org/auth/login');
  });
});
