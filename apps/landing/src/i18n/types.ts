export type Lang = "es" | "en";

export interface Source {
  name: string;
  url: string;
}

export interface Figure {
  /** La cifra tal como aparece en la fuente. */
  value: string;
  text: string;
  detail?: string;
  source: Source;
}

export interface Row {
  title: string;
  text: string;
}

export interface TechRow {
  name: string;
  id: string;
  role: string;
  state: "pipeline" | "optional" | "evaluated";
}

export interface AgentRow {
  name: string;
  text: string;
  approves: string;
}

export interface Week {
  label: string;
  happens: string;
  detects: string;
}

export interface MetricCopy {
  id: string;
  label: string;
  target: string;
}

export interface Dict {
  lang: Lang;
  htmlLang: string;
  meta: { title: string; description: string; ogLocale: string };
  skip: string;
  help: {
    danger: string;
    dangerCta: string;
    report: string;
    reportCta: string;
    ariaLabel: string;
    exit: string;
    exitShort: string;
    exitHint: string;
  };
  nav: {
    ariaLabel: string;
    how: string;
    commitments: string;
    tech: string;
    results: string;
    pilot: string;
    switchLabel: string;
    switchName: string;
    switchShort: string;
    switchHref: string;
    switchLang: Lang;
  };
  hero: {
    outside: string;
    inside: string;
    lead: string;
    ledgerLabel: string;
    actors: { id: string; actor: string; text: string; total: string }[];
    formIntro: string;
    formLabel: string;
    formPlaceholder: string;
    formCta: string;
    victimLine: string;
    shotCaption: string;
    shotAlt: string;
  };
  problem: {
    label: string;
    title: string;
    lead: string;
    figures: Figure[];
    sourcePrefix: string;
    gapTitle: string;
    gapSource: Source;
    gaps: Row[];
  };
  victim: {
    label: string;
    title: string;
    lead: string;
    features: Row[];
    found: { caption: string; chips: string[] };
    consentTitle: string;
    consent: { title: string; tag: string; text: string }[];
    cloud: string;
    shotOutside: string;
    shotOutsideAlt: string;
    shotReport: string;
    shotReportAlt: string;
  };
  community: {
    label: string;
    title: string;
    lead: string;
    method: string;
    demoTitle: string;
    fictitious: string;
    tablistLabel: string;
    weekWord: string;
    next: string;
    restart: string;
    legend: { voice: string; account: string };
    weeks: Week[];
    happensLabel: string;
    detectsLabel: string;
    table: {
      caption: string;
      cols: { case: string; who: string; phone: string; voice: string; account: string; note: string };
      rows: { id: string; who: string; phone: string; voice: string; account: string; note: string; week: number }[];
      noAudio: string;
      ghost: string;
    };
    alertTitle: string;
    alert: string;
    gate: string;
  };
  authority: {
    label: string;
    title: string;
    lead: string;
    example: string;
    dossierTitle: string;
    dossier: Row[];
    channel: string;
  };
  commitments: {
    label: string;
    title: string;
    lead: string;
    items: Row[];
    honestyTitle: string;
    honesty: string;
    legal: string;
    legalLink: Source;
  };
  tech: {
    label: string;
    title: string;
    lead: string;
    states: Record<TechRow["state"], string>;
    rows: TechRow[];
    agentsTitle: string;
    agentsLead: string;
    agents: AgentRow[];
    approvesLabel: string;
    rules: string;
    thirdParty: string;
  };
  results: {
    label: string;
    title: string;
    lead: string;
    placeholder: string;
    pendingNote: string;
    cols: { what: string; target: string; result: string };
    pending: string;
    metrics: MetricCopy[];
    generatedAt: string;
    passed: string;
    failed: string;
    sample: string;
  };
  pilot: {
    label: string;
    title: string;
    lead: string;
    who: string;
    fields: {
      org: string;
      name: string;
      contact: string;
      contactHint: string;
      sector: string;
      sectorNone: string;
      sectors: { value: string; label: string }[];
      district: string;
      members: string;
      message: string;
      optional: string;
      more: string;
    };
    errors: { org: string; name: string; contact: string; members: string; summary: string };
    verifying: string;
    verifyingWait: string;
    captchaLoad: string;
    noscript: string;
    submit: string;
    sending: string;
    success: string;
    successTitle: string;
    fail: string;
    rateLimited: string;
    captcha: string;
    unavailable: string;
    privacy: string;
  };
  helpSection: {
    label: string;
    title: string;
    lines: { number: string; name: string; cta: string }[];
    station: string;
    note: string;
  };
  footer: {
    hackathon: string;
    repo: string;
    fictitious: string;
    license: string;
  };
  notFound: { title: string; text: string; home: string };
}
