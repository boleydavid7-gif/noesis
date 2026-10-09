import { BookOpen, Brain, Library, Palette, UserRound, type LucideIcon } from 'lucide-react'

export type SettingsSectionId =
  'account' | 'reading' | 'appearance' | 'library' | 'backup' | 'ai' | 'notifications' | 'privacy' | 'about'

// Five places to look. Backup, privacy and about live under Account; reminders live under Library.
export const SETTINGS_SECTIONS: Array<{
  id: SettingsSectionId
  title: string
  subtitle: string
  icon: LucideIcon
  keywords: string
}> = [
  {
    id: 'reading',
    title: 'Reading',
    subtitle: 'Text, page colour and how pages turn',
    icon: BookOpen,
    keywords:
      'font size text theme paper sepia night line spacing wide width paragraphs justify drop cap tap letter dyslexia contrast listen speed chapter',
  },
  {
    id: 'appearance',
    title: 'Look',
    subtitle: 'Colours and pictures',
    icon: Palette,
    keywords: 'accent color gold blue green rose scenery background motion compact banner sidebar picture theme',
  },
  {
    id: 'library',
    title: 'Library',
    subtitle: 'Books, search and reminders',
    icon: Library,
    keywords:
      'sort index search storage rebuild remove confirm goal notes home reminders notification review cards due',
  },
  {
    id: 'ai',
    title: 'Noema',
    subtitle: 'What the AI companion can use',
    icon: Brain,
    keywords: 'noema ai answer length notes reading text spoilers meaning on device',
  },
  {
    id: 'account',
    title: 'Account and data',
    subtitle: 'Sign-in, backup, privacy and about',
    icon: UserRound,
    keywords:
      'profile name email password sign in out greeting backup sync cloud google drive onedrive dropbox export restore zip privacy data delete terms policy version contact help',
  },
]

// Older links ask for sections that now sit inside these five.
export function normalizeSection(id: SettingsSectionId): SettingsSectionId {
  if (id === 'backup' || id === 'privacy' || id === 'about') return 'account'
  if (id === 'notifications') return 'library'
  return id
}
