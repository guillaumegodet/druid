import React, { useMemo } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList
} from 'recharts';
import { Researcher, ResearcherStatus } from '../types';
import { Users, UserPlus, Activity, PieChart as PieIcon, BarChart3 } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { STATUS_LABELS } from '../lib/researcherLabels';

interface ResearcherDashboardProps {
  researchers: Researcher[];
}

/**
 * Theme colors (soft glass 2026 palette)
 */
const COLORS = {
  gender: ['#3b5bdb', '#e76f9a', '#9a9486'], // Blue, Pink, Warm gray
  age: ['#2ea066', '#3b5bdb', '#f4d24a', '#e76f9a'], // Green, Blue, Soft yellow, Pink
  primary: '#3b5bdb',
  dark: '#1c1b19'
};

/** Common style of the recharts tooltips (soft rounded card) */
const tooltipStyle = {
  borderRadius: 14,
  border: '1px solid rgba(28,27,25,.08)',
  boxShadow: '0 12px 30px -22px rgba(50,42,15,.5)',
  fontFamily: "'Hanken Grotesk', sans-serif",
  fontSize: '12px'
};

export const ResearcherDashboard: React.FC<ResearcherDashboardProps> = ({ researchers }) => {
  // `t` changes with the language: put it in the dependencies of the useMemo
  // calls producing labels, otherwise the charts would keep the previous language.
  const { t } = useLingui();

  const statusData = useMemo(() => {
    let interne = 0; let depart = 0; let parti = 0; let externe = 0;
    researchers.forEach(r => {
      if (r.status === ResearcherStatus.INTERNE) interne++;
      else if (r.status === ResearcherStatus.DEPART) depart++;
      else if (r.status === ResearcherStatus.PARTI) parti++;
      else externe++;
    });
    return [
      { name: t(STATUS_LABELS[ResearcherStatus.INTERNE]), value: interne, color: '#2ea066' }, // Green
      { name: t(STATUS_LABELS[ResearcherStatus.DEPART]), value: depart, color: '#d64545' },  // Soft red
      { name: t(STATUS_LABELS[ResearcherStatus.PARTI]), value: parti, color: '#3b5bdb' },    // Blue
      { name: t(STATUS_LABELS[ResearcherStatus.EXTERNE]), value: externe, color: '#e09e2a' }, // Amber
    ].filter(d => d.value > 0);
  }, [researchers, t]);

  const genderData = useMemo(() => {
    let f = 0; let m = 0; let other = 0;
    researchers.forEach(r => {
      const civ = (r.civility || '').toUpperCase().trim();
      // Broaden the detection to be resilient to input variations
      if (civ === 'F' || civ === 'MME' || civ.startsWith('MME') || civ.startsWith('MADAME') || civ.startsWith('MLLE')) {
        f++;
      } else if (civ === 'M' || civ === 'M.' || civ.startsWith('M.') || civ.startsWith('MONSIEUR') || civ.startsWith('MR')) {
        m++;
      } else if (civ !== '') {
        other++;
      }
    });

    const unknown = t`Unknown`;
    return [
      { name: t`Women`, value: f, color: COLORS.gender[1] },
      { name: t`Men`, value: m, color: COLORS.gender[0] },
      { name: unknown, value: other, color: COLORS.gender[2] },
    ].filter(d => d.value > 0 || d.name !== unknown); // Always keep Femmes/Hommes even at 0
  }, [researchers, t]);

  const ageData = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const buckets = [
      { name: t`< 30 years`, value: 0 },
      { name: t`31-45 years`, value: 0 },
      { name: t`46-60 years`, value: 0 },
      { name: t`61+ years`, value: 0 },
    ];
    researchers.forEach(r => {
      if (r.birthDate && typeof r.birthDate === 'string' && r.birthDate.includes('-')) {
        const yearStr = r.birthDate.split('-')[0];
        const year = parseInt(yearStr);
        if (!isNaN(year)) {
          const age = currentYear - year;
          if (age <= 30) buckets[0].value++;
          else if (age <= 45) buckets[1].value++;
          else if (age <= 60) buckets[2].value++;
          else buckets[3].value++;
        }
      }
    });
    return buckets;
  }, [researchers, t]);

  const gradeData = useMemo(() => {
    const counts: Record<string, number> = {};
    researchers.forEach(r => {
      const g = r.employment.grade || t`Unknown`;
      counts[g] = (counts[g] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [researchers, t]);

  const labData = useMemo(() => {
    const counts: Record<string, number> = {};
    researchers.forEach(r => {
      const lab = r.affiliations.find(a => a.isPrimary)?.structureName || r.affiliations[0]?.structureName || t`Undefined`;
      counts[lab] = (counts[lab] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [researchers, t]);

  const employerData = useMemo(() => {
    const counts: Record<string, number> = {};
    researchers.forEach(r => {
      const emp = r.employment.employer || t`Undefined`;
      counts[emp] = (counts[emp] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [researchers, t]);

  const contractTypeData = useMemo(() => {
    const counts: Record<string, number> = {};
    researchers.forEach(r => {
      const ct = r.employment.contractType || t`Undefined`;
      counts[ct] = (counts[ct] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [researchers, t]);

  const stats = useMemo(() => {
    const hdrCount = researchers.filter(r => r.nuFields?.hdr).length;
    return {
      total: researchers.length,
      hdrCount,
      percentageHdr: researchers.length > 0 ? Math.round((hdrCount / researchers.length) * 100) : 0
    };
  }, [researchers]);

  const identifierData = useMemo(() => {
    const counts = { orcid: 0, hal: 0, idref: 0, scopus: 0 };
    researchers.forEach(r => {
      if (r.identifiers.orcid) counts.orcid++;
      if (r.identifiers.halId) counts.hal++;
      if (r.identifiers.idref) counts.idref++;
      if (r.identifiers.scopusId) counts.scopus++;
    });
    return [
      { name: 'ORCID', value: counts.orcid, color: '#A6CE39' },
      { name: 'HAL', value: counts.hal, color: '#1c1b19' },
      { name: 'IdRef', value: counts.idref, color: '#7048e8' },
      { name: 'Scopus', value: counts.scopus, color: '#E9711C' },
    ];
  }, [researchers]);

  if (researchers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-muted-faint dark:text-[#8f897c]">
        <Activity className="w-16 h-16 opacity-20 mb-4" />
        <p className="font-disp text-2xl font-bold tracking-tight"><Trans>No data</Trans></p>
      </div>
    );
  }

  return (
    <div className="px-4 md:px-7 py-4 space-y-6 bg-transparent min-h-full">

      {/* Quick stat tiles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="glass-card p-6 flex items-center gap-5">
          <div className="w-14 h-14 rounded-2xl bg-[rgba(59,91,219,.14)] dark:bg-[rgba(59,91,219,.25)] flex items-center justify-center shrink-0">
            <Users className="w-7 h-7 text-[#3b5bdb] dark:text-[#9db1f2]" />
          </div>
          <div>
            <p className="section-label mb-1"><Trans>Headcount</Trans></p>
            <p className="font-disp text-4xl font-bold tracking-tight text-ink dark:text-[#f5f2ea] leading-none">{stats.total}</p>
          </div>
        </div>

        <div className="glass-card p-6 flex items-center gap-5">
          <div className="w-14 h-14 rounded-2xl bg-[rgba(231,111,154,.16)] dark:bg-[rgba(231,111,154,.25)] flex items-center justify-center shrink-0">
            <Activity className="w-7 h-7 text-[#e76f9a]" />
          </div>
          <div>
            <p className="section-label mb-1"><Trans>HDR rate</Trans></p>
            <p className="font-disp text-4xl font-bold tracking-tight text-ink dark:text-[#f5f2ea] leading-none">{stats.percentageHdr}%</p>
          </div>
        </div>

        <div className="glass-card p-6 flex items-center gap-5">
          <div className="w-14 h-14 rounded-2xl bg-[rgba(46,160,102,.16)] dark:bg-[rgba(46,160,102,.25)] flex items-center justify-center shrink-0">
            <UserPlus className="w-7 h-7 text-[#1f7a4d] dark:text-[#5fd39a]" />
          </div>
          <div>
            <p className="section-label mb-1"><Trans>Total HDR</Trans></p>
            <p className="font-disp text-4xl font-bold tracking-tight text-ink dark:text-[#f5f2ea] leading-none">{stats.hdrCount}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5 pb-10">

        {/* Breakdown by status */}
        <div className="glass-card p-6 h-[380px] flex flex-col">
          <h3 className="font-disp text-lg font-bold tracking-tight mb-4 flex items-center gap-2 text-ink dark:text-[#f5f2ea]">
            <PieIcon className="w-5 h-5 text-[#2ea066]" /> <Trans>Breakdown by status</Trans>
          </h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusData}
                  innerRadius={60}
                  outerRadius={85}
                  paddingAngle={4}
                  dataKey="value"
                  strokeWidth={2}
                  stroke={localStorage.getItem('theme') === 'dark' ? '#000' : '#fff'}
                >
                  {statusData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend
                   verticalAlign="bottom"
                   height={36}
                   iconType="circle"
                   formatter={(value) => <span className="text-[12px] font-semibold text-muted dark:text-[#8f897c]">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gender parity */}
        <div className="glass-card p-6 h-[380px] flex flex-col">
          <h3 className="font-disp text-lg font-bold tracking-tight mb-4 flex items-center gap-2 text-ink dark:text-[#f5f2ea]">
            <PieIcon className="w-5 h-5 text-[#e76f9a]" /> <Trans>Gender balance</Trans>
          </h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={genderData} innerRadius={60} outerRadius={85} paddingAngle={4} dataKey="value" strokeWidth={2} stroke={localStorage.getItem('theme') === 'dark' ? '#000' : '#fff'}>
                  {genderData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend verticalAlign="bottom" height={36} iconType="circle" formatter={(value) => <span className="text-[12px] font-semibold text-muted dark:text-[#8f897c]">{value}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Age pyramid */}
        <div className="glass-card p-6 h-[380px] flex flex-col">
          <h3 className="font-disp text-lg font-bold tracking-tight mb-4 flex items-center gap-2 text-ink dark:text-[#f5f2ea]">
            <Activity className="w-5 h-5 text-[#2ea066]" /> <Trans>Age groups</Trans>
          </h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ageData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="0" vertical={false} stroke="#1c1b1910" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9a9486', fontWeight: 600 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9a9486', fontWeight: 600 }} />
                <Tooltip cursor={{ fill: 'rgba(244,210,74,.12)' }} contentStyle={tooltipStyle} />
                <Bar dataKey="value" radius={[8, 8, 0, 0]} barSize={40}>
                  {ageData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS.age[index % COLORS.age.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Identifier coverage */}
        <div className="glass-card p-6 h-[380px] flex flex-col">
          <h3 className="font-disp text-lg font-bold tracking-tight mb-4 flex items-center gap-2 text-ink dark:text-[#f5f2ea]">
            <Activity className="w-5 h-5 text-[#3b5bdb]" /> <Trans>Identifier coverage</Trans>
          </h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={identifierData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9a9486', fontWeight: 600 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9a9486', fontWeight: 600 }} />
                <Tooltip cursor={{ fill: 'rgba(244,210,74,.12)' }} contentStyle={tooltipStyle} />
                <Bar dataKey="value" radius={[8, 8, 0, 0]} barSize={40}>
                  {identifierData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Breakdown by employer (horizontal) */}
        <div className="glass-card p-6 h-[380px] flex flex-col">
          <h3 className="font-disp text-lg font-bold tracking-tight mb-4 flex items-center gap-2 text-ink dark:text-[#f5f2ea]">
            <Users className="w-5 h-5 text-[#e09e2a]" /> <Trans>Employers (top 8)</Trans>
          </h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={employerData} layout="vertical" margin={{ left: 10, right: 40 }}>
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" width={110} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#8c8677', fontWeight: 600 }} />
                <Tooltip cursor={{ fill: 'rgba(244,210,74,.12)' }} contentStyle={tooltipStyle} />
                <Bar dataKey="value" fill="#f4d24a" radius={[0, 8, 8, 0]} barSize={15}>
                   <LabelList dataKey="value" position="right" style={{ fontSize: 11, fontWeight: 700, fill: '#9a9486', fontFamily: "'Hanken Grotesk', sans-serif" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Breakdown by grade (horizontal) */}
        <div className="glass-card p-6 h-[340px] flex flex-col">
          <h3 className="font-disp text-lg font-bold tracking-tight mb-4 flex items-center gap-2 text-ink dark:text-[#f5f2ea]">
            <BarChart3 className="w-5 h-5 text-[#3b5bdb]" /> <Trans>Grades (top 8)</Trans>
          </h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={gradeData} layout="vertical" margin={{ left: 5, right: 30 }}>
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" width={90} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#8c8677', fontWeight: 600 }} />
                <Tooltip cursor={{ fill: 'rgba(244,210,74,.12)' }} contentStyle={tooltipStyle} />
                <Bar dataKey="value" fill={COLORS.primary} radius={[0, 8, 8, 0]} barSize={15} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Breakdown by employment type */}
        <div className="glass-card p-6 h-[380px] flex flex-col">
          <h3 className="font-disp text-lg font-bold tracking-tight mb-4 flex items-center gap-2 text-ink dark:text-[#f5f2ea]">
            <BarChart3 className="w-5 h-5 text-[#e76f9a]" /> <Trans>Employment types (top 10)</Trans>
          </h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={contractTypeData} layout="vertical" margin={{ left: 10, right: 40 }}>
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" width={130} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8c8677', fontWeight: 600 }} />
                <Tooltip cursor={{ fill: 'rgba(244,210,74,.12)' }} contentStyle={tooltipStyle} />
                <Bar dataKey="value" fill="#e76f9a" radius={[0, 8, 8, 0]} barSize={13}>
                  <LabelList dataKey="value" position="right" style={{ fontSize: 11, fontWeight: 700, fill: '#9a9486', fontFamily: "'Hanken Grotesk', sans-serif" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Breakdown by membership (horizontal) */}
        <div className="glass-card p-6 h-[340px] flex flex-col lg:col-span-2">
          <h3 className="font-disp text-lg font-bold tracking-tight mb-4 flex items-center gap-2 text-ink dark:text-[#f5f2ea]">
            <BarChart3 className="w-5 h-5 text-[#2ea066]" /> <Trans>Breakdown by lab (top 8)</Trans>
          </h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={labData} layout="vertical" margin={{ left: 10, right: 40 }}>
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" width={110} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#8c8677', fontWeight: 600 }} />
                <Tooltip cursor={{ fill: 'rgba(244,210,74,.12)' }} contentStyle={tooltipStyle} />
                <Bar dataKey="value" fill="#2ea066" radius={[0, 8, 8, 0]} barSize={15}>
                  <LabelList dataKey="value" position="right" style={{ fontSize: 11, fill: '#9a9486', fontFamily: "'Hanken Grotesk', sans-serif" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </div>
  );
};
