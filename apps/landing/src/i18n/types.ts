import type { ProductShot } from "../lib/screenshots";

export type Lang = "es" | "en";

/** Una frase que abre con una entrada en negrita ("Por fuera,") y sigue en tinta suave. */
export interface RunIn {
  lead: string;
  text: string;
}

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

export interface MetricCopy {
  id: string;
  label: string;
  target: string;
}

/** Texto alternativo y pie de una captura real de la consola o del portal. */
export interface ShotCopy {
  alt: string;
  caption: string;
  /** Pie del recorte que se ve en el celular, si muestra solo un detalle. */
  mobileCaption?: string;
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
    benefits: string;
    product: string;
    how: string;
    intelligence: string;
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
    /** El titular, en dos líneas. */
    title: [string, string];
    /** La palabra del titular que va en el color de la voz. */
    voiceWord: string;
    lead: string;
    serves: string;
    ctaPilot: string;
    ctaHow: string;
    repo: string;
    /** El quipu: la red A, B y C en cuatro semanas. */
    demo: {
      label: string;
      fictitious: string;
      stepsLabel: string;
      weekWord: string;
      caseWord: string;
      guild: string;
      rows: { phone: string; voice: string; account: string };
      cases: { id: string; who: string }[];
      tieVoice: string;
      tieAccount: string;
      reviewer: string;
      proposed: string;
      network: string;
      outputs: [string, string, string];
      weeks: string[];
    };
  };
  problem: {
    title: string;
    lead: string;
    figures: Figure[];
    sourcePrefix: string;
    gapTitle: string;
    gapSource: Source;
    gaps: Row[];
  };
  actors: {
    title: string;
    lead: string;
    victim: {
      name: string;
      title: string;
      lead: string;
      points: Row[];
      illo: {
        label: string;
        outside: string;
        inside: string;
        key: string;
        note: string;
        ledgerTitle: string;
        ledger: { item: string; amount: string }[];
        totalLabel: string;
        total: string;
        evidence: { kind: "voice" | "phrase" | "image"; text: string }[];
        foundLabel: string;
        found: string[];
        caseLabel: string;
      };
      shotOutsideAlt: string;
      shotInsideAlt: string;
      cloud: string;
    };
    community: {
      name: string;
      title: string;
      lead: string;
      points: Row[];
      consent: { title: string; tag: string; text: string }[];
      shot: ShotCopy;
    };
    authority: {
      name: string;
      title: string;
      lead: string;
      dossier: Row[];
      channel: string;
      shot: ShotCopy;
    };
  };
  intel: {
    title: string;
    lead: string;
    link: { title: string; text: string; shot: ShotCopy };
    network: { title: string; text: string; shot: ShotCopy };
    alert: { title: string; text: string; cardTitle: string; card: string; cardMeta: string };
    advice: { title: string; text: string; shot: ShotCopy };
    agentsTitle: string;
    agentsLead: string;
    approvesLabel: string;
    agents: { name: string; text: string; approves: string }[];
    rules: string;
  };
  authenticity: {
    title: string;
    lead: string;
    checksTitle: string;
    checks: { name: string; text: string; by: string }[];
    verdictsTitle: string;
    verdicts: Row[];
    absence: string;
    shot: ShotCopy;
    /** Rastreo de filtraciones (PLAN D14): las marcas de agua de Meta al revés. */
    leak: {
      title: string;
      lead: string;
      points: Row[];
      figure: { label: string; accounts: [string, string, string]; leaked: string; match: string; note: string };
      measured: string;
      measuredLink: string;
      limit: string;
      prod: string;
      shot: ShotCopy;
    };
  };
  tech: {
    title: string;
    lead: string;
    pipelineLabel: string;
    pipeline: { stage: string; items: string[] }[];
    modelsTitle: string;
    groups: { title: string; rows: { name: string; id: string; use: string }[] }[];
    honestTitle: string;
    honest: string[];
  };
  commitments: {
    title: string;
    lead: string;
    items: Row[];
    honestyTitle: string;
    honesty: string;
    legal: string;
    legalLink: Source;
  };
  results: {
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
    meets: string;
    misses: string;
    noTarget: string;
    extraTitle: string;
    fullReport: string;
    reportedNote: string;
    leak: {
      title: string;
      lead: string;
      rows: Record<string, string>;
      limitTag: string;
      falseLabel: string;
      /** "{a} de {na} pruebas de audio y {i} de {ni} de imagen". */
      falseValue: string;
      source: string;
    };
  };
  pilot: {
    title: string;
    lead: string;
    who: string;
    steps: string[];
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
    shots: string;
  };
  notFound: { title: string; text: string; home: string };
  /** La landing de producto: portada, beneficios por actor, pasos, recorrido y Meta AI. */
  lp: {
    hero: {
      lead: string;
      points: string[];
      /** Nombre accesible de la composición de la portada (consola y portal). */
      stageLabel: string;
      consoleTitle: string;
      simulated: string;
      /** Nota a mano sobre la captura del grafo; decorativa, la explica el pie. */
      annotation: string;
      note: string;
      phoneAlt: string;
      consoleAlt: string;
    };
    built: { label: string; items: string[] };
    problem: { gapsTitle: string };
    benefits: {
      title: string;
      lead: string;
      illustration: string;
      audiences: {
        id: "victim" | "community" | "authority";
        name: string;
        title: string;
        points: string[];
      }[];
    };
    how: {
      title: string;
      lead: string;
      steps: { title: string; text: string; tag: string }[];
      demoTitle: string;
      demoLead: string;
    };
    tour: {
      title: string;
      lead: string;
      tabsLabel: string;
      items: {
        tab: string;
        title: string;
        note: string;
        text: string;
        shot: ProductShot;
        alt: string;
        caption: string;
        /** Nota a mano sobre la captura (solo en pantallas anchas); decorativa. */
        pen?: string;
      }[];
    };
    tech: {
      apiLabel: string;
      openLabel: string;
      agentsTitle: string;
      agentsLead: string;
    };
    trust: { title: string; lead: string };
    /** Menú de secciones en celular y tableta. */
    menu: { label: string; faq: string };
    /** Cuatro resultados medidos, arriba de las tablas. */
    results: { label: string; highlights: { id: string; label: string }[]; leakId: string; leakLabel: string; target: string };
    faq: { title: string; lead: string; items: { q: string; a: string }[] };
  };
  /** Texto propio del diseño "informe impreso": titulares cortos, entradas, filas y pies de foto. */
  page: {
    mast: {
      fact: string;
      factText: string;
      howCta: string;
      /** Nombre accesible y pie del quipu animado de la portada. */
      figLabel: string;
      figCaption: string;
    };
    problemTitle: [string, string];
    quipu: { title: string; lead: string; plateCaption: string };
    victim: { title: string; runIns: RunIn[]; foundTitle: string };
    review: {
      title: string;
      states: [string, string, string];
      caseA: string;
      caseB: string;
      tie: string;
      score: string;
      detail: string;
      proposedBy: string;
      confirm: string;
      discard: string;
      confirmed: string;
      undo: string;
      discarded: string;
    };
    features: {
      title: string;
      rows: { title: string; note: string; text: string; shot: ProductShot; alt: string; caption: string }[];
    };
    tech: {
      title: [string, string];
      lead: string;
      modelsLabel: string;
      groups: { kind: string; rows: { name: string; use: string }[] }[];
      agentsLabel: string;
      approves: string;
      /** Pie del diagrama del pipeline: qué significa la línea punteada. */
      diagramNote: string;
      agents: { name: string; what: string; approves: string }[];
    };
    results: { title: string };
    pilot: { title: string; steps: RunIn[] };
    foot: {
      callLine: string;
      reportLine: string;
      top: string;
      creditsLabel: string;
      place: string;
    };
  };
}
