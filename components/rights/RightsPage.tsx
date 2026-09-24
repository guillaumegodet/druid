// « Gestion des droits » tab (super admin only, see DashboardPage.tsx).
// Read-only: browsing the Keycloak group tree under the
// institution (server.cjs proxy /api/admin/rights/* → service account
// druid-rights-viewer). Actual rights assignment stays in the Keycloak
// console — see the CRISalid reference mockup:
// https://crisalid-esr.github.io/SVP-mockups/fr/rights/
//
// Model (CRISalid proposal, not Druid-specific): a tree of Keycloak
// groups follows the org chart (institution > lab > team), with
// one leaf per role at each level. The full group path is
// encoded in the JWT; each client app (SoVisu+, chatbot, Projects,
// Druid…) derives role + scope by parsing the path. Druid currently
// interprets only two roles: `admin` (super admin) and `dashboard_viewer`
// (read Annuaire/Structures/Dashboard), see server.cjs parseDruidAccess.
import React, { useEffect, useMemo, useState } from 'react';
import { Users, FolderTree, Shield, ChevronRight, AlertCircle } from 'lucide-react';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { apiErrorText } from '../../lib/apiErrors';

type RightsTab = 'users' | 'groups' | 'roles';

interface RightsUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  groups: string[];
}

interface GroupLeafNode {
  id: string;
  name: string;
  path: string;
  isRoleLeaf: true;
  members: { id: string; username: string; email?: string; firstName?: string; lastName?: string }[];
}
interface GroupBranchNode {
  id: string;
  name: string;
  path: string;
  isRoleLeaf: false;
  children: GroupNode[];
}
type GroupNode = GroupLeafNode | GroupBranchNode;
interface GroupTree {
  id: string;
  name: string;
  path: string;
  children: GroupNode[];
}

interface RoleDef {
  key: string;
  label: MessageDescriptor;
  description: MessageDescriptor;
  interpretedByDruid: boolean;
}

// Cross-cutting vocabulary proposed by CRISalid (see droits.md / mockRights.ts
// in SVP-mockups) — Druid interprets only part of it; the others are
// shown for information (cross-app convention, not a local config).
const ROLES: RoleDef[] = [
  {
    key: 'admin',
    label: msg`Administrator`,
    description:
      msg`All rights on the scope. At institution level (root), equivalent to a global administrator — this role is what grants access to this tab.`,
    interpretedByDruid: true,
  },
  {
    key: 'dashboard_viewer',
    label: msg`Dashboard viewer`,
    description:
      msg`Read access to the Directory, Structures and the bibliometric dashboard (Dashboard/Benchmark) of the scope. Role proposed by Druid, modelled on document_viewer/project_viewer.`,
    interpretedByDruid: true,
  },
  {
    key: 'labo_viewer',
    label: msg`Own-laboratory viewer`,
    description:
      msg`Staff and dashboard limited to one's own laboratory, derived from one's directory record (rows carrying the identifier, current memberships). Implicit right: any signed-in user without another Druid right has it by default — the group does not need to be filled.`,
    interpretedByDruid: true,
  },
  {
    key: 'document_viewer',
    label: msg`Document viewer`,
    description: msg`Views the publications and reports of the scope (SoVisu+).`,
    interpretedByDruid: false,
  },
  {
    key: 'document_editor',
    label: msg`Document editor`,
    description: msg`Corrects, validates and deposits the publications of the scope (SoVisu+).`,
    interpretedByDruid: false,
  },
  {
    key: 'account_editor',
    label: msg`Account manager`,
    description: msg`Creates, edits and merges the accounts and identifiers of people in the scope (SoVisu+).`,
    interpretedByDruid: false,
  },
  {
    key: 'project_viewer',
    label: msg`Project viewer`,
    description: msg`Views the research projects of the scope (Projects).`,
    interpretedByDruid: false,
  },
  {
    key: 'project_editor',
    label: msg`Project editor`,
    description: msg`Creates and edits the research projects of the scope (Projects).`,
    interpretedByDruid: false,
  },
];

/** Role (last segment) + scope (previous segments) of a Keycloak group
 * path — for display only, same logic as server.cjs. */
const parseGroupPath = (groupPath: string) => {
  const segments = groupPath.split('/').filter(Boolean);
  const role = segments[segments.length - 1] ?? '';
  const scopeLabel = segments.length > 1 ? segments[segments.length - 2] : segments[0] ?? '';
  const isEstablishment = segments.length <= 2;
  return { role, scopeLabel, isEstablishment };
};

const useJson = <T,>(url: string) => {
  const { t } = useLingui();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<T>;
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? apiErrorText(err) : t`Unknown error`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url]);
  return { data, error, loading };
};

const RoleChip: React.FC<{ groupPath: string }> = ({ groupPath }) => {
  const { role, scopeLabel, isEstablishment } = parseGroupPath(groupPath);
  return (
    <span
      className="pill inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-accent/20 dark:bg-accent/15 text-ink dark:text-[#f5f2ea]"
      title={groupPath}
    >
      {role} <span className="text-muted-light dark:text-[#8f897c]">·</span>{' '}
      {isEstablishment ? <Trans>institution</Trans> : scopeLabel}
    </span>
  );
};

const UsersTab: React.FC<{ users: RightsUser[] }> = ({ users }) => (
  <div className="flex flex-col gap-2">
    {users.length === 0 && (
      <p className="text-sm text-muted-light dark:text-[#8f897c]"><Trans>No user with a right recognised by Druid.</Trans></p>
    )}
    {users.map((u) => (
      <div key={u.id} className="glass-card p-3 flex flex-col gap-1.5">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-semibold text-sm text-ink dark:text-[#f5f2ea]">
            {u.firstName || u.lastName ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() : u.username}
          </span>
          <span className="text-xs text-muted-light dark:text-[#8f897c]">
            {u.username}{u.email ? ` · ${u.email}` : ''}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {u.groups.map((g) => <RoleChip key={g} groupPath={g} />)}
        </div>
      </div>
    ))}
  </div>
);

const GroupNodeRow: React.FC<{ node: GroupNode; depth: number }> = ({ node, depth }) => (
  <div style={{ marginLeft: depth * 16 }} className="flex flex-col gap-1">
    <div className="flex items-center gap-1.5 py-1 text-sm">
      {depth > 0 && <ChevronRight className="w-3.5 h-3.5 text-muted-lighter shrink-0" />}
      <span className={node.isRoleLeaf ? 'font-mono text-xs px-1.5 py-0.5 rounded bg-accent/20 dark:bg-accent/15' : 'font-semibold text-ink dark:text-[#f5f2ea]'}>
        {node.name}
      </span>
      {node.isRoleLeaf && (
        <span className="text-xs text-muted-light dark:text-[#8f897c]">
          <Plural value={node.members.length} one="# member" other="# members" />
        </span>
      )}
    </div>
    {node.isRoleLeaf === true
      ? node.members.length > 0 && (
          <div style={{ marginLeft: 20 }} className="text-xs text-muted-light dark:text-[#8f897c]">
            {node.members.map((m) => (m.firstName || m.lastName ? `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() : m.username)).join(', ')}
          </div>
        )
      : node.children.map((c) => <GroupNodeRow key={c.id} node={c} depth={depth + 1} />)}
  </div>
);

const GroupsTab: React.FC<{ tree: GroupTree }> = ({ tree }) => (
  <div className="glass-card p-4">
    <div className="flex items-center gap-1.5 text-sm font-semibold text-ink dark:text-[#f5f2ea] mb-2">
      <FolderTree className="w-4 h-4" /> {tree.name}
    </div>
    {tree.children.length === 0 ? (
      <p className="text-sm text-muted-light dark:text-[#8f897c]"><Trans>No subgroup.</Trans></p>
    ) : (
      tree.children.map((c) => <GroupNodeRow key={c.id} node={c} depth={1} />)
    )}
  </div>
);

const RolesTab: React.FC = () => {
  const { t } = useLingui();
  return (
  <div className="flex flex-col gap-2">
    {ROLES.map((r) => (
      <div key={r.key} className="glass-card p-3 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-accent/20 dark:bg-accent/15">{r.key}</span>
          <span className="font-semibold text-sm text-ink dark:text-[#f5f2ea]">{t(r.label)}</span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              r.interpretedByDruid
                ? 'bg-pixel-teal/20 text-pixel-teal'
                : 'bg-muted-lighter/30 text-muted-light dark:text-[#8f897c]'
            }`}
          >
            {r.interpretedByDruid ? t`interpreted by Druid` : t`other app`}
          </span>
        </div>
        <p className="text-sm text-muted-light dark:text-[#8f897c]">{t(r.description)}</p>
      </div>
    ))}
  </div>
  );
};

export const RightsPage: React.FC = () => {
  const { t } = useLingui();
  const [tab, setTab] = useState<RightsTab>('users');
  const users = useJson<{ users: RightsUser[] }>('/api/admin/rights/users');
  const groups = useJson<GroupTree>('/api/admin/rights/groups');

  const subTabs = useMemo(
    () => [
      { key: 'users' as const, label: t`Users`, icon: Users },
      { key: 'groups' as const, label: t`Keycloak groups`, icon: FolderTree },
      { key: 'roles' as const, label: t`Roles`, icon: Shield },
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-light dark:text-[#8f897c] leading-snug">
        <Trans>
          Read-only — mirrors the group tree of the Keycloak realm <code className="font-mono text-xs">crisalid-inst</code> under the institution. Rights are assigned (adding or removing a user from a group) in the Keycloak console, not here.
        </Trans>
      </p>

      <div className="flex flex-wrap gap-1.5">
        {subTabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`btn-pill px-3 py-1.5 text-[13px] flex items-center gap-1.5 ${tab === key ? 'bg-ink text-white dark:bg-accent dark:text-ink' : ''}`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'roles' ? (
        <RolesTab />
      ) : (
        <>
          {(tab === 'users' ? users : groups).loading && (
            <p className="text-sm text-muted-light dark:text-[#8f897c]"><Trans>Querying Keycloak…</Trans></p>
          )}
          {(tab === 'users' ? users.error : groups.error) && (
            <div className="glass-card p-4 flex items-center gap-2 text-sm text-red-500">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <Trans>
                Keycloak unavailable ({tab === 'users' ? users.error : groups.error}) — check the KEYCLOAK_ADMIN_CLIENT_ID/SECRET config and that the institution group exists.
              </Trans>
            </div>
          )}
          {tab === 'users' && users.data && <UsersTab users={users.data.users} />}
          {tab === 'groups' && groups.data && <GroupsTab tree={groups.data} />}
        </>
      )}
    </div>
  );
};
