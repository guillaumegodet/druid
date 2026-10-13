import { LayoutDashboard, BookOpenText, Quote, Handshake, Users, Compass, Radar } from 'lucide-react';
import type { DashboardFamily } from './dashboardNav';

/** Icon of each family (family pills of DashboardPage, « Explore » cards of the overview). */
export const FAMILY_ICONS: Record<DashboardFamily, React.FC<{ className?: string }>> = {
  overview: LayoutDashboard,
  publications: BookOpenText,
  impact: Quote,
  collaborations: Handshake,
  people: Users,
  steering: Compass,
  watch: Radar,
};
