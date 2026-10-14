import { pageUser, can, ROLE_LABELS } from '@/lib/auth';
import { activeContext } from '@/lib/context';
import { Shell } from '@/components/shell';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await pageUser();
  const ctx = await activeContext(user);
  return (
    <Shell
      user={{ name: user.name, roleLabel: ROLE_LABELS[user.role] }}
      entities={ctx.entities.map((e) => ({ id: e.id, name: e.name }))}
      entityId={ctx.entity?.id ?? null}
      fiscalYears={ctx.fiscalYears.map((f) => ({ id: f.id, title: f.title, closed: f.status === 'CLOSED' }))}
      fiscalYearId={ctx.fiscalYear?.id ?? null}
      perms={{ settings: can(user, 'settings.accounting'), entities: can(user, 'settings.entities'), users: can(user, 'users.manage') }}
    >
      {children}
    </Shell>
  );
}
