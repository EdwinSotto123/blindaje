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
    signals: string;
    map: string;
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
    ctaPilot: string;
    ctaHow: string;
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
      /** Titular: la primera línea y, en la segunda, un prefijo con la palabra resaltada que cambia. */
      line1: string;
      prefix: string;
      swap: string[];
      /** El titular completo para lectores de pantalla (la palabra que cambia es decorativa). */
      srTitle: string;
      lead: string;
      /** Acción principal: el mapa público por distrito del portal. */
      ctaMap: string;
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
    /** Dónde pasa: el mapa esquemático de distritos y sus reglas públicas. */
    where: {
      title: string;
      lead: string;
      rules: string[];
      cta: string;
      label: string;
      legend: { sin_datos: string; bajo: string; medio: string; alto: string };
      note: string;
    };
    /** Las señales que compara Blindaje, con los glifos del grafo de la consola. */
    signals: {
      title: string;
      lead: string;
      items: { kind: "voz" | "imagen" | "frase" | "id" | "cobro" | "zona"; name: string; text: string; example: string; how: string }[];
      note: string;
    };
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
    problemTitle: [string, string];
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
