import React, { createContext, useContext, useState } from 'react';

export type Language = 'gu' | 'en';

const dictionary = {
  appTitle: { gu: 'ખોરાક (KHORAK)', en: 'KHORAK (ખોરાક)' },
  appSubtitle: {
    gu: 'આંગણવાડી પોષણ પુરવઠા અને સ્ટોક ટ્રેકર — પંચમહાલ',
    en: 'Anganwadi Inventory & Nutrition Supply Chain — Panchmahal',
  },
  signIn: { gu: 'લૉગિન કરો', en: 'Sign in' },
  signOut: { gu: 'લૉગઆઉટ', en: 'Sign out' },
  username: { gu: 'વપરાશકર્તા નામ', en: 'Username' },
  password: { gu: 'પાસવર્ડ', en: 'Password' },
  demoAccounts: { gu: 'ડેમો ખાતાઓ (પંચમહાલ)', en: 'Demo Accounts (Panchmahal)' },
  // Navigation
  navHome: { gu: 'હોમ', en: 'Home' },
  navInventory: { gu: 'સ્ટોક', en: 'Inventory' },
  navDistribution: { gu: 'વિતરણ', en: 'Distribution' },
  navHistory: { gu: 'ઇતિહાસ', en: 'Activity' },
  navProfile: { gu: 'પ્રોફાઇલ', en: 'Profile' },
  navDashboard: { gu: 'ડેશબોર્ડ', en: 'Dashboard' },
  navCreateDispatch: { gu: 'ડિસ્પેચ બનાવો', en: 'Create Dispatch' },
  navDispatches: { gu: 'ડિસ્પેચ યાદી', en: 'Dispatches' },
  navDiscrepancies: { gu: 'તફાવત કેસો', en: 'Discrepancies' },
  navReconciliation: { gu: 'સ્ટોક મેળવણી', en: 'Reconciliation' },
  navExpiry: { gu: 'એક્સપાયરી', en: 'Expiry' },
  navAlerts: { gu: 'ચેતવણીઓ', en: 'Reorder Alerts' },
  navReports: { gu: 'અહેવાલો', en: 'Reports' },
  // AWW Home
  namasteGreeting: { gu: 'નમસ્તે', en: 'Namaste' },
  currentStockSummary: { gu: 'હાલનો ઉપયોગી સ્ટોક', en: 'Usable Stock Summary' },
  pendingDeliveries: { gu: 'આવનારી ડિલિવરી', en: 'Pending Deliveries' },
  stockAndExpiryAlerts: { gu: 'સ્ટોક અને એક્સપાયરી ચેતવણી', en: 'Stock & Expiry Alerts' },
  // Primary actions
  actionReceiveStock: { gu: 'સ્ટોક સ્વીકારો', en: 'Receive Stock' },
  actionScanQr: { gu: 'આધાર QR સ્કેન', en: 'Scan Aadhaar QR' },
  actionDistribute: { gu: 'પોષણ વિતરણ', en: 'Distribute Ration' },
  actionViewInventory: { gu: 'સ્ટોક જુઓ', en: 'View Inventory' },
  actionReportSpoilage: { gu: 'બગાડ નોંધો', en: 'Report Spoilage' },
  actionRecordUsage: { gu: 'વપરાશ નોંધો (HCM)', en: 'Record Usage' },
  // Offline & Sync states
  online: { gu: 'ઓનલાઇન', en: 'Online' },
  offline: { gu: 'ઓફલાઇન મોડ', en: 'Offline Mode' },
  savedLocally: { gu: 'સ્થાનિક સાચવેલ', en: 'Saved locally' },
  pendingSync: { gu: 'સિંક બાકી', en: 'Pending synchronisation' },
  synchronised: { gu: 'સર્વર સાથે સિંક', en: 'Synchronised' },
  syncFailed: { gu: 'સિંક નિષ્ફળ', en: 'Failed' },
  syncNow: { gu: 'હમણાં સિંક કરો', en: 'Sync Now' },
  // General
  usable: { gu: 'ઉપયોગી', en: 'Usable' },
  expired: { gu: 'એક્સપાયર્ડ', en: 'Expired' },
  expiringSoon: { gu: 'ટૂંક સમયમાં એક્સપાયર', en: 'Expiring Soon' },
  daysLeft: { gu: 'દિવસ બાકી', en: 'days left' },
  estimated: { gu: 'અંદાજિત', en: 'Estimated' },
  cancel: { gu: 'રદ કરો', en: 'Cancel' },
  confirm: { gu: 'પુષ્ટિ કરો', en: 'Confirm' },
  save: { gu: 'સાચવો', en: 'Save' },
  loading: { gu: 'લોડ થઈ રહ્યું છે...', en: 'Loading...' },
  syntheticBanner: {
    gu: 'પંચમહાલ જિલ્લાનો સિન્થેટિક ડેમો ડેટા • POSHAN ટ્રેકર પૂરક',
    en: 'Synthetic Panchmahal Demonstration Data • Complements POSHAN Tracker',
  },
} as const;

export type TranslationKey = keyof typeof dictionary;

interface I18nContextValue {
  lang: Language;
  setLang: (l: Language) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    const saved = localStorage.getItem('khorak_lang');
    return saved === 'en' ? 'en' : 'gu';
  });

  const setLang = (next: Language) => {
    setLangState(next);
    localStorage.setItem('khorak_lang', next);
    document.documentElement.lang = next;
  };

  const t = (key: TranslationKey) => dictionary[key][lang];

  return React.createElement(
    I18nContext.Provider,
    { value: { lang, setLang, t } },
    children
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside LanguageProvider');
  return ctx;
}

