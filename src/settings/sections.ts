import {
  Bell,
  BookOpen,
  Brain,
  CloudUpload,
  Info,
  Library,
  Palette,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from 'lucide-react'

export type SettingsSectionId =
  'account' | 'reading' | 'appearance' | 'library' | 'backup' | 'ai' | 'notifications' | 'privacy' | 'about'

export const SETTINGS_SECTIONS: Array<{
  id: SettingsSectionId
  title: string
  subtitle: string
  icon: LucideIcon
  keywords: string
}> = [
  {
    id: 'account',
    title: 'Account',
    subtitle: 'Profile and connected accounts',
    icon: UserRound,
    keywords: 'profile name email password sign in out greeting',
  },
  {
    id: 'reading',
    title: 'Reading',
    subtitle: 'Display, fonts, and reading experience',
    icon: BookOpen,
    keywords: 'font size text theme paper sepia night line spacing wide',
  },
  {
    id: 'appearance',
    title: 'Appearance',
    subtitle: 'Theme and visual preferences',
    icon: Palette,
    keywords: 'accent color gold blue green rose scenery background motion compact',
  },
  {
    id: 'library',
    title: 'Library',
    subtitle: 'Books and downloads',
    icon: Library,
    keywords: 'sort index search storage rebuild remove confirm',
  },
  {
    id: 'backup',
    title: 'Backup & Sync',
    subtitle: 'Keep your knowledge safe',
    icon: CloudUpload,
    keywords: 'cloud google drive onedrive dropbox sync export restore zip backup',
  },
  {
    id: 'ai',
    title: 'AI Companion',
    subtitle: 'Noema settings and behavior',
    icon: Brain,
    keywords: 'noema ai answer length notes reading text',
  },
  {
    id: 'notifications',
    title: 'Notifications',
    subtitle: 'Alerts and reminders',
    icon: Bell,
    keywords: 'review reminders alerts due cards',
  },
  {
    id: 'privacy',
    title: 'Privacy',
    subtitle: 'Data and security',
    icon: ShieldCheck,
    keywords: 'data delete export terms policy security',
  },
  {
    id: 'about',
    title: 'About',
    subtitle: 'Version and information',
    icon: Info,
    keywords: 'version build contact help',
  },
]
