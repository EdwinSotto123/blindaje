import type { Dict } from "./types";
import { SOURCES } from "./sources";

const src = {
  exitosa: { ...SOURCES.exitosa, name: "Exitosa, with Public Ministry data (in Spanish)" },
  larepublica: { ...SOURCES.larepublica, name: "La República, editorial of June 22, 2026 (in Spanish)" },
  americatv: { ...SOURCES.americatv, name: "América TV (in Spanish)" },
  elcomercio: { ...SOURCES.elcomercio, name: "El Comercio (in Spanish)" },
  ley29733: { ...SOURCES.ley29733, name: "Law 29733 on Personal Data Protection (in Spanish)" },
};

export const en: Dict = {
  lang: "en",
  htmlLang: "en",
  meta: {
    title: "Blindaje: community intelligence against extortion",
    description:
      "Blindaje collects the evidence extortion victims keep, turns it into intelligence and shows which districts it happens in, never which home. A person reviews every link.",
    ogLocale: "en_US",
  },
  skip: "Skip to content",
  help: {
    ariaLabel: "Immediate help in Peru",
    danger: "In danger right now?",
    dangerCta: "Call 105",
    report: "To report extortion:",
    reportCta: "Línea 1818",
    exit: "Quick exit",
    exitShort: "Exit",
    exitHint: "Opens a neutral page. Shortcut: press Esc twice.",
  },
  nav: {
    ariaLabel: "Sections",
    benefits: "Benefits",
    signals: "Signals",
    map: "Map",
    product: "Product",
    how: "How it works",
    intelligence: "Intelligence",
    tech: "Meta AI",
    results: "Results",
    pilot: "Request access",
    switchLabel: "Leer en español",
    switchName: "Español",
    switchShort: "ES",
    switchHref: "/",
    switchLang: "es",
  },
  hero: {
    ctaPilot: "Request access",
    ctaHow: "See how it works",
  },
  problem: {
    title: "Thousands of reports. Each victim alone against a network.",
    lead:
      "Gangs work in series: the same voice calls several victims, they send the same photos, repeat the same script and the same account collects from different vendors. That information exists, but it is scattered across the phones of people who never meet.",
    sourcePrefix: "Source:",
    figures: [
      {
        value: "13,892",
        text: "extortion reports were filed with Peru’s Public Ministry between January and July 2026.",
        detail:
          "Prosecution districts with the most cases: Lima Este (1,806), La Libertad (1,625), Lima Sur (1,346), Lima Norte (1,305) and Lima Centro (1,178).",
        source: src.exitosa,
      },
      {
        value: "27,000",
        text: "extortion reports or more closed out 2025, according to Public Prosecutor data.",
        source: src.larepublica,
      },
      {
        value: "80",
        text: "percent of public transport companies admitted to paying monthly protection fees to criminal gangs.",
        detail: "At least 69 drivers were killed on the job in 2025, with extortion as the main motive.",
        source: src.larepublica,
      },
      {
        value: "26,217",
        text: "extortion reports at the end of the period analyzed, up from 4,761, while sentenced prisoners fell from 712 to 650.",
        detail: "The outlet notes the figures alone do not explain the gap: more reports do not automatically mean more convictions.",
        source: src.elcomercio,
      },
    ],
    gapTitle: "And the numbers fall short: many victims never report, for fear of retaliation.",
    gapSource: src.americatv,
    gaps: [
      {
        title: "Weak evidence",
        text: "Untranscribed WhatsApp voice notes, undated screenshots, timelines rebuilt from memory.",
      },
      {
        title: "Disconnected cases",
        text: "No one compares the voice threatening a shopkeeper with the one threatening a mototaxi driver in another district.",
      },
      {
        title: "Fear of reporting",
        text: "Victims doubt reporting helps, fear the extortioner will find out and have no one they trust to turn to.",
      },
    ],
  },
  actors: {
    title: "Everyone gets something concrete.",
    lead:
      "Victims document without exposing themselves, the community knows where it happens and the authorities receive cases that are already linked.",
    victim: {
      name: "Victim",
      title: "Keep the evidence where no one will notice.",
      lead:
        "On the phone, Blindaje looks like an ordinary app for your business, and you choose which one. It really works. Your private notes open with a secret entry and your PIN.",
      points: [
        {
          title: "Decoy PIN and quick exit",
          text: "A decoy PIN opens empty, believable notes. One tap returns to the everyday app and locks it. Zero notifications.",
        },
        {
          title: "Everything uploads encrypted",
          text: "Record, take a photo or paste a WhatsApp voice note. It uploads encrypted as soon as you save it and stays out of your gallery.",
        },
        {
          title: "What we found",
          text: "Blindaje transcribes and highlights the facts: how much they demand, through which channel, the deadline and who they claim to be.",
        },
        {
          title: "Your police report, ready",
          text: "With a timeline and integrity fingerprints, ready to take to the police station.",
        },
      ],
      illo: {
        label: "The same app, outside and inside",
        outside: "Outside: a sales notebook that really works",
        inside: "Inside: your private notes",
        key: "Secret entry and PIN",
        note: "Illustration. You choose the disguise; this is one of them.",
        ledgerTitle: "Today’s sales",
        ledger: [
          { item: "2 milks", amount: "S/ 9.00" },
          { item: "Bread, 10 rolls", amount: "S/ 3.00" },
          { item: "Soda", amount: "S/ 2.50" },
        ],
        totalLabel: "Total",
        total: "S/ 14.50",
        evidence: [
          { kind: "voice", text: "WhatsApp voice note, 0:24" },
          { kind: "phrase", text: "Message: “2,000 soles via Yape within 48 hours”" },
          { kind: "image", text: "Photo of the shop with a bullet" },
        ],
        foundLabel: "What we found",
        found: ["Demands 2,000 soles", "Via Yape", "48-hour deadline", "Claims to be “Los X”"],
        caseLabel: "Case A",
      },
      shotOutsideAlt: "Screenshot of the app from the outside: it looks like an ordinary business app",
      shotInsideAlt: "Screenshot of the app from the inside: private notes with the saved evidence",
      cloud:
        "Without a signal, the evidence waits encrypted on the phone and is deleted from it once the upload is confirmed. Only authorized people can see it.",
    },
    community: {
      name: "Community and businesses",
      title: "See where it happens and know what to do.",
      lead:
        "With consent, each case is compared with the others. The team approves anonymous alerts by district and every business sees prevention advice for its area and trade.",
      points: [
        {
          title: "Aggregate figures only",
          text: "Nothing is shown with fewer than 5 cases from 3 different victims. There is no search for numbers or accounts.",
        },
      ],
      consent: [
        {
          title: "Only my report",
          tag: "The default",
          text: "Blindaje organizes your evidence and builds your report. Nothing leaves your case.",
        },
        {
          title: "Community mode",
          tag: "You turn it on",
          text: "Your pseudonymized signals are compared with other cases. You can withdraw whenever you want.",
        },
      ],
      shot: {
        alt: "Screenshot of the public portal on a phone: map of the districts of Lima and Callao with risk levels in ranges, no account.",
        caption: "The public portal on a phone, in Spanish, with no account. Simulated mode, fictitious data.",
      },
    },
    authority: {
      name: "Authorities",
      title: "Network case files for police and prosecutors.",
      lead:
        "When an authorized analyst approves a network, Blindaje assembles the case file as a PDF. It is only sent through a formal channel with the authorities.",
      dossier: [
        { title: "Network summary", text: "Size, period, sectors and shared modus operandi." },
        { title: "Unified timeline", text: "Events from every case, in order." },
        { title: "Explained links", text: "Each link with its score, its signals and the cited evidence." },
        { title: "SHA-256 fingerprints", text: "Every original file with its integrity fingerprint and UTC time." },
        { title: "Chain of custody", text: "Who uploaded what and when, in a hash-chained log." },
      ],
      channel:
        "Accounts that appear in several cases are flagged so the authorities can request them through legal channels. Blindaje shares no data with banks or fintechs.",
      shot: {
        alt: "Screenshot of the console: the Cartographer’s profile of network R-001, with cited facts on the left and hypotheses awaiting approval on the right.",
        caption: "The Cartographer keeps facts apart from hypotheses. Only what is approved goes into the case file. Console in Spanish, simulated mode, fictitious data.",
      },
    },
  },
  intel: {
    title: "What no victim can see alone.",
    lead:
      "Every voice note, message and photo becomes comparable signals. With them, Blindaje’s agents link cases, map networks, draft alerts and advice, and check whether the evidence is real. None of them decides alone.",
    link: {
      title: "Links cases even when the number changes",
      text: "It compares voiceprints, collection accounts, reused photos and scripts. The Linker explains each possible link citing the evidence: what supports it and what contradicts it. A team reviewer confirms or dismisses it.",
      shot: {
        alt: "Screenshot of the console: the Linker explains the link between Case A and Case B. The voice matches in 4 of 5 segments, even though the contact numbers and accounts differ.",
        caption: "Same voice, different numbers. Score 0.91, citations verified.",
      },
    },
    network: {
      title: "Maps the network behind the cases",
      text: "Confirmed links form networks. The Cartographer analyzes each one: period, modus operandi, escalation and the evidence still missing.",
      shot: {
        alt: "Graph of network R-001: three cases joined by voiceprint V-3 and Yape account ···488, with their numbers, signature phrases and image.",
        caption: "Network R-001: three cases, one voice, one account.",
        mobileCaption: "Detail of network R-001: voiceprint V-3 joins cases A and B even though their numbers differ.",
      },
    },
    alert: {
      title: "Warns the area before the next case",
      text: "The Lookout detects a pattern repeated in at least 5 cases from 3 different victims within 14 days and drafts the alert. A person on the team approves it and it is published for that district.",
      cardTitle: "Alert approved by the Blindaje team",
      card: "Voice notes claiming to be from “Los X” are demanding payment via Yape. Don’t pay or negotiate: report it to Línea 1818 or at your police station.",
      cardMeta: "Fictitious example",
    },
    advice: {
      title: "Advises businesses on prevention",
      text: "The Advisor drafts advice by area and trade from aggregate data. A validator checks that every claim cites evidence, that no numbers or accounts appear and that it never advises paying or negotiating. A person on the team approves it before any business sees it.",
      shot: {
        alt: "Screenshot of the console: the Advisor’s draft for mototaxis in Lima Este. The validator found a claim without a citation and a citation that does not exist.",
        caption: "The validator catches an uncited claim before it reaches the portal.",
      },
    },
    agentsTitle: "Six agents, and always a person who approves.",
    agentsLead:
      "They run on Muse Spark through the Responses API, with strict JSON schema output. The investigative ones use tool calling. Besides the four above:",
    approvesLabel: "Approved by",
    agents: [
      {
        name: "Linker",
        text: "Explains each possible link between two cases and adjusts the score when it spots contradictions.",
        approves: "A team reviewer",
      },
      {
        name: "Cartographer",
        text: "Analyzes a network: period, modus operandi, roles suggested by the graph and missing evidence.",
        approves: "An authorized analyst",
      },
      {
        name: "Lookout",
        text: "Detects patterns repeating in a district and drafts the alert for that area.",
        approves: "The team",
      },
      {
        name: "Case writer",
        text: "Turns an approved network into a PDF case file with a timeline and chain of custody.",
        approves: "An authorized analyst",
      },
      {
        name: "Advisor",
        text: "Drafts prevention advice by area and trade, using aggregate figures only.",
        approves: "A person on the team",
      },
      {
        name: "Authenticity",
        text: "Looks for signs that a voice note, photo or video was AI-generated or manipulated.",
        approves: "The reviewer, when deciding the link",
      },
    ],
    rules: "Every claim cites evidence: without a citation, the output is invalid. Never names of people. Web search is off.",
  },
  tech: {
    title: "Built with Meta AI. Every model has a specific job.",
    lead:
      "Evidence flows through a pipeline on Cloudflare and an ML container. Every piece is transcribed, segmented, summarized into a case record and turned into signals that can be compared.",
    pipelineLabel: "From file to decision",
    pipeline: [
      { stage: "Evidence", items: ["WhatsApp voice note", "Message", "Photo", "Video"] },
      { stage: "Models", items: ["Muse Voice Transcribe", "Muse Spark 1.3 and 1.2", "SAM 3.1", "DINOv2", "AudioSeal and Video Seal"] },
      { stage: "Signals", items: ["Voiceprint", "Case record", "HMAC identifiers", "Crops and vectors", "Authenticity"] },
      { stage: "Agents", items: ["Linker", "Cartographer", "Lookout", "Case writer", "Advisor"] },
      { stage: "A person approves", items: ["Link", "Alert", "Advice", "Case file"] },
    ],
    modelsTitle: "What we use and what for",
    groups: [
      {
        title: "Meta Model API",
        rows: [
          {
            name: "Muse Spark 1.3",
            id: "muse-spark-1.3",
            use: "Builds the case record with strict JSON schema output, drives the agents with tool calling over the Responses API and looks for manipulation in photos and videos.",
          },
          {
            name: "Muse Spark 1.2",
            id: "muse-spark-1.2",
            use: "Listens to audio directly for the forensic voice analysis, since 1.3 lacks full audio support.",
          },
          {
            name: "Muse Voice Transcribe 1.0",
            id: "muse-voice-transcribe-1.0",
            use: "Transcribes with speaker diarization, per-turn timestamps and a custom vocabulary: Yape, Plin, cupo, derecho de piso.",
          },
          {
            name: "SAM 3.1",
            id: "sam-3.1",
            use: "Finds bullets, handwritten notes and license plates in photos and video frames from text prompts, and masks bystanders’ faces.",
          },
          {
            name: "Muse Image 1.0",
            id: "muse-image-1.0",
            use: "Generated the fictitious photos for the demo and the evaluation. No photo is real.",
          },
          {
            name: "Muse Wonder 1.0",
            id: "muse-wonder-1.0",
            use: "Optional: the Cartographer uses it when a network is very large.",
          },
        ],
      },
      {
        title: "Meta open models and libraries",
        rows: [
          {
            name: "AudioSeal",
            id: "facebook/audioseal",
            use: "Detects AI watermarks in audio and, in reverse, marks every audio copy with the 16-bit tag of the account that plays it.",
          },
          {
            name: "Video Seal",
            id: "facebookresearch/videoseal",
            use: "Detects AI watermarks in photos and videos, and marks every image copy with a 256-bit message per delivery.",
          },
          {
            name: "DINOv2",
            id: "dinov2-small",
            use: "Turns each crop into a vector to find reused images even when they are not identical.",
          },
          { name: "FAISS", id: "faiss", use: "Three search indexes: voice, text and image." },
          { name: "PyTorch", id: "torch", use: "Runs the models in the ML container." },
          { name: "React Native and Hermes", id: "react-native", use: "The victim’s app, on Android." },
          { name: "React", id: "react", use: "The review console and the business portal." },
        ],
      },
    ],
    honestTitle: "What is not Meta, and what we ruled out",
    honest: [
      "Voiceprints (SpeechBrain ECAPA) and text vectors (multilingual-e5-small) use third-party open models, because the Meta Model API has no embeddings endpoint.",
      "We evaluated Muse Glimmer for building the case record on the phone, offline. It is a dense 30B-parameter model, about 17 GB even at 4 bits: it does not fit on a phone. The record is built on the server, with consent.",
    ],
  },
  commitments: {
    title: "What Blindaje does not do.",
    lead: "These limits are part of the design, not a footnote. They protect victims and prevent serious mistakes.",
    items: [
      {
        title: "It decides nothing without a person.",
        text: "Every link, alert, piece of advice and case file is a draft until an authorized person approves it.",
      },
      {
        title: "It does not identify people.",
        text: "It links cases and signals. It never puts a name to a voice or searches for anyone online: the agents have no web search.",
      },
      { title: "It does not show a victim other victims’ data.", text: "Nor does it tell them their case was linked." },
      {
        title: "It never advises paying or negotiating.",
        text: "Not to victims, not to businesses. It always points to 105, Línea 1818 and the police station.",
      },
      {
        title: "It publishes no addresses, homes or exact counts.",
        text: "The map is by district, in ranges, with no totals, and needs at least 5 cases from 3 different victims.",
      },
      { title: "It does not decide guilt.", text: "Every link is a hypothesis with its score and its evidence." },
      { title: "It uses no real data in the demo.", text: "Cases, voices, numbers, accounts and photos are fictitious." },
      { title: "It has no political content.", text: "" },
    ],
    honestyTitle: "And we say it plainly",
    honesty:
      "The server processes evidence to transcribe and compare it, so this is not end-to-end encryption. Evidence is encrypted in transit and at rest, and only authorized roles can see it, with a hash-chained audit log.",
    legal: "Before any pilot with real victims, a legal review is required under Peru’s",
    legalLink: src.ley29733,
  },
  results: {
    title: "What we measure, with fictitious data.",
    lead:
      "The evaluation uses threat scripts written for the project and voices from an open corpus of Peruvian Spanish (OpenSLR SLR73), compressed the way WhatsApp does. We publish the real results, whatever they are.",
    placeholder: "The evaluation report is not available yet.",
    pendingNote: "The evaluation has not published its report yet. Targets are working goals, not results.",
    cols: { what: "What is measured", target: "Target", result: "Result" },
    pending: "Pending",
    metrics: [
      { id: "voice_top1", label: "Voice linking: the right case ranks first", target: "80% or more" },
      { id: "voice_top3", label: "Voice linking: the right case is in the top 3", target: "90% or more" },
      { id: "false_links_per_100", label: "Wrong links per 100 comparisons above the review threshold", target: "2 at most" },
      { id: "identifier_match", label: "Exact identifier matches detected", target: "100%" },
      { id: "ficha_accuracy", label: "Case record fields correct against manual labels", target: "90% or more" },
      { id: "citation_fidelity", label: "Agent claims with cited, verifiable evidence", target: "100%" },
      { id: "small_stats", label: "Statistics shown with fewer than 5 cases", target: "0" },
      { id: "infiltrator", label: "Infiltrator test: receives no links or other cases’ data", target: "Pass" },
    ],
    generatedAt: "Report generated on",
    passed: "Pass",
    failed: "Fail",
    sample: "samples",
    meets: "Meets the target",
    misses: "Misses the target",
    noTarget: "No target",
    extraTitle: "Other results, no target",
    fullReport: "Full evaluation report (in Spanish)",
    reportedNote: "Real results from a run on fictitious data. Targets are working goals, not guarantees.",
    leak: {
      title: "Leak tracing",
      lead: "Marked copies attributed to the right account after each change, with fictitious media and 50 simulated recipients.",
      rows: {
        "audio.whatsapp_opus_16k": "Audio forwarded on WhatsApp (Opus 16 kbps)",
        "imagen.whatsapp": "Image recompressed by WhatsApp",
        "imagen.recorte_10_whatsapp": "Image cropped by 10% and forwarded on WhatsApp",
        "imagen.captura_png": "Screenshot of the image",
        "imagen.captura_whatsapp": "Screenshot forwarded on WhatsApp",
        "audio.fragmento_6s_opus_16k": "6-second audio clip cut at an arbitrary point",
        "audio.opus_8k": "Audio compressed to Opus 8 kbps (extreme case)",
      },
      limitTag: "Known limit",
      falseLabel: "Unmarked media wrongly attributed to an account",
      falseValue: "{a} of {na} audio tests and {i} of {ni} image tests",
      source: "Leak tracing results (eval/results/watermark.json)",
    },
  },
  pilot: {
    title: "Request access for your institution.",
    lead:
      "Blindaje works with institutions that can act: police stations, prosecutors, municipalities and NGOs. Guilds, churches and neighborhood councils can help spread the app.",
    who: "Police and prosecutors receive each network’s file through a formal channel. Municipalities and NGOs use the map and alerts for their districts, which are already public.",
    steps: [
      "We talk with your institution.",
      "We run the legal review before handling real data.",
      "We start in one or two districts.",
    ],
    fields: {
      org: "Institution or organization name",
      name: "Your name",
      contact: "WhatsApp, mobile or email",
      contactHint: "So we can reply. We never share it.",
      sector: "Type of institution",
      sectorNone: "Choose one",
      sectors: [
        { value: "policia", label: "Police" },
        { value: "fiscalia", label: "Prosecutors" },
        { value: "municipalidad", label: "Municipality" },
        { value: "ong", label: "NGO or victim support" },
        { value: "difusion", label: "Guild, church or council (to spread it)" },
        { value: "otro", label: "Other" },
      ],
      district: "District or province",
      members: "How many people would use it",
      message: "Anything we should know?",
      optional: "optional",
      more: "Add details (optional)",
    },
    errors: {
      org: "Enter your institution’s name (at least 2 letters).",
      name: "Enter your name (at least 2 letters).",
      contact: "Enter a mobile number (6 digits or more) or an email so we can reply.",
      members: "Enter a whole number, without dots or commas.",
      summary: "Check the highlighted fields.",
    },
    verifying: "Automatic spam check",
    verifyingWait: "It starts by itself once you begin filling in the form.",
    captchaLoad: "We could not load the automatic check. Check your connection and reload the page.",
    noscript: "To send this form, turn on JavaScript in your browser.",
    submit: "Send request",
    sending: "Sending…",
    successTitle: "We received your request.",
    success:
      "We will write to the contact you left to talk about your institution and the next steps, starting with the legal review. Thank you for joining.",
    fail: "We could not send your request. Check your connection and try again.",
    rateLimited: "Too many requests came from your connection. Wait a few minutes and try again.",
    captcha: "The automatic check has not finished yet. Wait a few seconds and send again.",
    unavailable: "The form is not available right now. Try again in a few minutes.",
    privacy:
      "We use this data only to answer your request. This form is not for reporting a crime: if you are in danger, call 105.",
  },
  helpSection: {
    title: "If you are in danger right now, call 105.",
    lines: [
      { number: "105", name: "Peruvian National Police, emergencies", cta: "Call 105" },
      { number: "1818", name: "Línea 1818, the Interior Ministry’s single reporting line", cta: "Call Línea 1818" },
    ],
    station: "You can also report at your nearest police station.",
    note: "Don’t pay or negotiate. Keep the voice notes and messages, and report it.",
  },
  footer: {
    hackathon: "Built for the Meta Global AI Developer Hackathon, from October 26 to November 4, 2026.",
    repo: "Code on GitHub",
    fictitious: "All demo and evaluation data is fictitious. Nothing on this page comes from real victims.",
    license: "Open source under the Apache-2.0 license.",
    shots: "Screenshots show Blindaje’s console and public portal in simulated mode.",
  },
  notFound: {
    title: "This page does not exist.",
    text: "The link may be mistyped.",
    home: "Back to the home page",
  },
  lp: {
    hero: {
      title: "No one should face extortion alone.",
      lead:
        "Blindaje brings together what victims keep (audio, photos, messages, numbers and accounts) to uncover the same gang behind different cases and show which districts it hits. A person reviews every link.",
      ctaMap: "See the district map",
      ctaMapShort: "See the map",
      audienceLabel: "For",
      audience: ["corner shops", "mototaxi drivers", "market stalls", "transport workers"],
      photoAlt: "Yellow, blue and red mototaxis waiting for passengers on a pedestrian street in central Lima.",
      photoCredit: "Illustrative photo: Paulo Guereta, CC BY 2.0. It shows no victims.",
      phoneAlt: "Screenshot of the public portal on a phone: in Ate, the risk for corner shops is high, between 10 and 19 cases.",
      phoneCap: "The public portal, no account. Fictitious data.",
    },
    built: {
      label: "Built with Meta AI",
      items: ["Muse Spark", "Muse Voice Transcribe", "SAM 3.1", "AudioSeal", "Video Seal", "DINOv2", "FAISS", "PyTorch", "React Native"],
    },
    signals: {
      title: "The traces a gang leaves behind.",
      lead: "Swapping a SIM card is easy. Changing your voice, your photos, your script and your collection account is not. Blindaje compares every trace across all cases.",
      items: [
        {
          kind: "voz",
          name: "Voice",
          text: "The voiceprint of every voice note, segment by segment, even when they call from another number.",
          example: "V-3 in cases A and B · 4 of 5 segments",
          how: "Muse Voice Transcribe · ECAPA voiceprint · Muse Spark 1.2 checks for synthetic voice",
        },
        {
          kind: "imagen",
          name: "Photos and video",
          text: "Bullets, handwritten notes and license plates cropped from every photo or video. It finds the same image even after a forward or a crop.",
          example: "IMG-1 · photo of the shop with a bullet",
          how: "SAM 3.1 · DINOv2 · perceptual hash",
        },
        {
          kind: "frase",
          name: "Speech patterns",
          text: "The script, the phrases they repeat and who they claim to represent.",
          example: "“talk to the boss” · “don’t call the police” · “Los X”",
          how: "Muse Spark 1.3 builds the case sheet · text vectors",
        },
        {
          kind: "id",
          name: "Numbers, accounts and plates",
          text: "Phones, Yape or Plin accounts and plates, encrypted with HMAC: compared without exposing the data and with no search box.",
          example: "Yape ···488 in cases B and C",
          how: "Muse Spark 1.3 extracts them · HMAC",
        },
        {
          kind: "cobro",
          name: "How they collect",
          text: "How much they ask for, the deadline and the payment channel. On its own it never links: it adds to the other signals.",
          example: "2,000 soles · Yape · 48 hours",
          how: "Case sheet by Muse Spark 1.3",
        },
        {
          kind: "zona",
          name: "Area and dates",
          text: "Which district and when, never an address. The Lookout spots the same pattern in the same area and the Cartographer orders the network in time.",
          example: "5 cases from 3 victims in 14 days",
          how: "Lookout and Cartographer · Muse Spark 1.3",
        },
      ],
      note: "No signal decides alone: the engine combines them into a calibrated score and a person confirms every link.",
    },
    problem: { gapsTitle: "Why today is not enough" },
    benefits: {
      title: "A concrete benefit for everyone.",
      lead:
        "Victims document without exposing themselves, the community knows where it happens and what to do, and the authorities get cases already linked.",
      illustration: "Illustration of the app. Outside, a working sales notebook; inside, the private notes. You choose the disguise.",
      victimPhotoAlt: "Inside a corner shop in Lima: shelves of goods, stacked red beer crates and two people at the counter, seen from behind.",
      victimPhotoCredit: "Illustrative photo: cemeiakano, CC BY-SA 2.0. It shows no victims.",
      audiences: [
        {
          id: "victim",
          name: "Victims",
          title: "Report directly, without anyone noticing.",
          points: [
            "They install the app with no code and no guild. They choose the disguise.",
            "Secret entrance, decoy PIN, quick exit and zero notifications.",
            "Voice notes, photos and messages upload encrypted and never sit in the gallery.",
            "The police report comes out ready, with a timeline and integrity fingerprints.",
          ],
        },
        {
          id: "community",
          name: "Community and businesses",
          title: "See where it happens and know what to do.",
          points: [
            "A district map, public and with no account.",
            "Alerts and prevention advice for their area and trade, approved by a person.",
            "Ranges, not exact counts, and nothing with fewer than 5 cases from 3 victims.",
            "Never an address, a number or an account.",
          ],
        },
        {
          id: "authority",
          name: "Police and prosecutors",
          title: "Get cases already linked, with the evidence cited.",
          points: [
            "A PDF case file with the timeline of the whole network.",
            "Every link explained, with its score and its signals.",
            "SHA-256 fingerprints and chain of custody for every file.",
            "Which districts the network works in, and repeated accounts to request through legal channels.",
          ],
        },
      ],
    },
    where: {
      title: "Where it happens, by district.",
      lead: "Cases are grouped by district, never by street or home. The map is public and needs no account.",
      rules: [
        "Ranges, not exact counts: 5-9, 10-19, 20-49 or 50+.",
        "Nothing where there are fewer than 5 cases from 3 victims: that district looks the same as one with none.",
        "No totals that allow subtraction, and no addresses or coordinates.",
        "More cases can mean more reporting there, not more danger.",
      ],
      cta: "Open the map",
      label: "Schematic map of the 50 districts of Lima and Callao with fictitious data",
      legend: { sin_datos: "No data or few cases", bajo: "Low", medio: "Medium", alto: "High" },
      note: "Fictitious data. Each square is a district in its approximate position.",
      photoAlt: "An avenue in Lima with mototaxis and cars; behind it, a hill covered with houses.",
      photoCredit: "Illustrative photo: moctezuma nacario, CC BY 3.0. It does not mark a place where cases happened.",
    },
    how: {
      title: "Collect, analyze, locate.",
      lead: "From a victim’s WhatsApp voice note to the district map and the network’s case file. Models propose; people decide.",
      steps: [
        {
          title: "Collect",
          text: "Any victim installs the disguised app, picks their district and keeps voice notes, photos, videos and messages. They upload encrypted.",
          tag: "Android app",
        },
        {
          title: "Analyze",
          text: "Muse Voice Transcribe transcribes by speaker and Muse Spark builds the case sheet. Every piece becomes signals: voice, photos, script phrases, numbers, accounts, area and dates.",
          tag: "Meta AI",
        },
        {
          title: "Link",
          text: "The Linker compares the signals with every case and explains each possible link. A person on the Blindaje team confirms or dismisses it.",
          tag: "Agents and human review",
        },
        {
          title: "Show where it happens",
          text: "Cases are grouped by district: the community sees the map and the alerts for its area, and police and prosecutors get the network’s case file.",
          tag: "District map",
        },
      ],
      demoTitle: "Try it: you review.",
      demoLead: "This link just reached the team’s console. Confirm it or dismiss it.",
    },
    tour: {
      title: "Everything Blindaje does.",
      lead: "Real screenshots of the console and the portal in simulated mode, with fictitious data.",
      tabsLabel: "Blindaje features",
      items: [
        {
          tab: "Link cases",
          title: "Links cases even when the number changes",
          note: "Linker · Muse Spark 1.3",
          text: "It compares voiceprints, collection accounts, reused photos and scripts. The Linker explains each possible link citing the evidence: what supports it and what contradicts it. A team reviewer confirms or dismisses it.",
          shot: "consola-vinculo-misma-voz",
          alt: "Console screenshot: the Linker explains the link between Case A and Case B. The voice matches in 4 of 5 segments, even though the contact numbers and accounts differ.",
          caption: "Same voice, different numbers. Score 0.91, citations verified. Fictitious data.",
          pen: "every citation, checked",
        },
        {
          tab: "Map the network",
          title: "Maps the network behind the cases",
          note: "Cartographer · Muse Spark 1.3 with tool calling",
          text: "Confirmed links form networks. The Cartographer analyzes each one: time span, modus operandi, escalation and the evidence still missing. It keeps facts apart from hypotheses.",
          shot: "consola-red-grafo",
          alt: "Console screenshot: graph of network R-001, with three cases tied by voiceprint V-3 and Yape account ···488.",
          caption: "Network R-001: three cases, one voice, one account. Fictitious data.",
          pen: "same account, another case",
        },
        {
          tab: "Areas",
          title: "Sees which districts it happens in",
          note: "Area view · threshold of 5 cases from 3 victims",
          text: "The console groups cases by district, compares them with the previous period and shows which networks and patterns repeat in each one. A district with few cases shows no figures.",
          shot: "consola-zonas",
          alt: "Console screenshot: grid of the districts of Lima and Callao with cases per district. San Juan de Lurigancho is selected: 14 cases from 11 victims in 28 days, rising.",
          caption: "The team’s area view. Fictitious data.",
        },
        {
          tab: "Advise",
          title: "Advises businesses on prevention",
          note: "Advisor · Muse Spark 1.3, strict JSON schema",
          text: "The Advisor drafts advice by area and trade from aggregate data. A validator checks that every claim cites evidence, that no numbers or accounts appear and that it never advises paying or negotiating. A person on the team approves it before any business sees it.",
          shot: "consola-recomendaciones-asesor",
          alt: "Console screenshot: the Advisor’s draft for mototaxis in Ate. The validator found a claim without a citation and a citation that does not exist.",
          caption: "The validator catches an uncited claim before it reaches the portal. Fictitious data.",
        },
        {
          tab: "Case file",
          title: "Builds the case file for prosecutors",
          note: "Writer · PDF with SHA-256 fingerprints and chain of custody",
          text: "When an analyst approves a network, the Writer builds the PDF case file: a unified timeline, links explained with their evidence, a SHA-256 fingerprint for every file and the chain of custody. It is sent only through a formal channel.",
          shot: "consola-perfil-cartografo",
          alt: "Console screenshot: profile of network R-001, with cited facts on the left and hypotheses awaiting approval on the right.",
          caption: "Only what is approved goes into the case file. Fictitious data.",
        },
        {
          tab: "Authenticity",
          title: "Checks whether the evidence is real",
          note: "AudioSeal · Video Seal · C2PA · Muse Spark 1.2 listens to the audio",
          text: "A voice can be faked with AI. Blindaje looks for watermarks with AudioSeal and Video Seal, reads C2PA credentials and metadata, and Muse Spark listens and looks for tells. Evidence is marked as AI-made only with technical proof.",
          shot: "consola-autenticidad-evidencia",
          alt: "Console screenshot: audio EV-C2 shows strong signs of AI; no AudioSeal watermark, no C2PA, and a flat intonation without breathing.",
          caption: "Authenticity of a voice note. Fictitious data.",
          pen: "signs, not proof",
        },
        {
          tab: "Leaks",
          title: "Traces who leaked a copy",
          note: "AudioSeal: 16 bits per account · Video Seal: 256 bits per delivery",
          text: "Meta’s watermarks, turned around: every audio and image that leaves the console carries the account that requested it, hidden inside. If a copy shows up outside, admins see which account it came from, even after a WhatsApp forward.",
          shot: "consola-rastreo-filtracion",
          alt: "Console screenshot: the Video Seal watermark of a photo forwarded on WhatsApp matches the copy received by the Demo Reviewer, with 98% of the bits.",
          caption: "Trace a leak, admins only. Fictitious data.",
          pen: "the copy came from this account",
        },
        {
          tab: "Public map",
          title: "Shows the map to the community",
          note: "Public portal · no account",
          text: "Anyone picks their district and trade and sees the risk level, the alerts and the advice approved by the team. Ranges only, never exact counts or addresses.",
          shot: "portal-mapa",
          alt: "Public portal screenshot: map of the 50 districts of Lima and Callao with low, medium and high levels, and beside it the list of districts with data, from San Juan de Lurigancho (high, 20-49) to Villa El Salvador (low, 5-9). Ate is marked as your district.",
          caption: "Public portal in simulated mode. Fictitious data.",
        },
      ],
    },
    tech: {
      apiLabel: "Meta Model API",
      openLabel: "Meta’s open models and libraries",
      agentsTitle: "Six agents, and always a person who approves.",
      agentsLead:
        "They run on Muse Spark 1.3 through the Responses API, with strict JSON schema output. Every claim cites evidence: without a citation, the output is rejected.",
    },
    trust: {
      title: "What Blindaje does not do.",
      lead: "These limits are part of the design, not a footnote. They protect victims and prevent serious mistakes.",
    },
    menu: { label: "Menu", faq: "FAQ" },
    results: {
      label: "Measured results",
      highlights: [
        { id: "voice_top1", label: "of the time, the voice found the right case first" },
        { id: "false_links_per_100", label: "wrong links per 100 comparisons" },
        { id: "ficha_accuracy", label: "of case-sheet fields correct against the manual label" },
      ],
      leakId: "audio.whatsapp_opus_16k",
      leakLabel: "of voice notes forwarded on WhatsApp, traced to their account",
      target: "Target",
    },
    faq: {
      title: "Frequently asked questions.",
      lead: "What institutions and the people who spread the app usually ask.",
      items: [
        {
          q: "Does a victim need to belong to a guild?",
          a: "No. Any victim installs the app and reports. Guilds, churches, neighborhood councils or municipalities can help spread it, but they do not review or approve anything.",
        },
        {
          q: "Who sees a victim’s evidence?",
          a: "Only the Blindaje analysis team, as far as the victim allows. Evidence travels encrypted, is stored encrypted and every access is written to a chained audit log. A victim never sees data from other cases.",
        },
        {
          q: "What does the map show?",
          a: "Districts, never streets or homes. It shows ranges, not exact counts, and nothing where there are fewer than 5 cases from 3 victims. It always warns that more cases can mean more reporting there.",
        },
        {
          q: "What if someone checks the victim’s phone?",
          a: "They see a working sales app. The private notes open with a secret entrance and a PIN; a decoy PIN opens empty, believable notes, and one tap goes back to the usual app. There are no notifications.",
        },
        {
          q: "How are fake reports stopped without a guild vetting members?",
          a: "A person on the team reviews every link before it counts, no signal decides alone, there is a registration limit per connection and suspicious devices can be flagged.",
        },
        {
          q: "Does Blindaje accuse anyone or replace the police?",
          a: "No. It links cases and signals, never puts a name to a voice and never searches for anyone online. It always points to 105, Línea 1818 and the police station, and the case file reaches the authorities only through a formal channel.",
        },
        {
          q: "How does an institution join?",
          a: "We talk, run the legal review under Peru’s Law 29733 before handling real data and start in one or two districts.",
        },
      ],
    },
  },
  page: {
    problemTitle: ["Thousands of reports.", "Each victim, alone."],
    review: {
      title: "A person confirms every link.",
      states: ["Proposed", "In review", "Confirmed"],
      caseA: "Case A · shopkeeper",
      caseB: "Case B · mototaxi driver",
      tie: "Same voice",
      score: "0.91",
      detail: "The voice matches in 4 of 5 segments, even though the numbers and accounts differ.",
      proposedBy: "Proposed by the Linker, with verified citations",
      confirm: "Confirm link",
      discard: "Dismiss",
      confirmed: "Confirmed by the team reviewer · Oct 28, 10:42",
      undo: "Undo",
      discarded: "Dismissed by the reviewer. Not used for linking.",
    },
    tech: {
      title: ["Built with Meta AI,", "piece by piece."],
      lead: "Every voice note, message, photo or video goes through Meta models, becomes signals that can be compared and reaches agents that propose. A person approves.",
      modelsLabel: "Models",
      groups: [
        {
          kind: "Meta Model API",
          rows: [
            { name: "Muse Spark 1.3", use: "Case sheet and agents" },
            { name: "Muse Spark 1.2", use: "Voice forensics" },
            { name: "Muse Voice Transcribe", use: "Transcribes by speaker" },
            { name: "SAM 3.1", use: "Bullets, notes, plates; blurs faces" },
            { name: "Muse Image 1.0", use: "Fictitious demo photos" },
            { name: "Muse Wonder 1.0", use: "Large networks, optional" },
          ],
        },
        {
          kind: "Open from Meta",
          rows: [
            { name: "AudioSeal", use: "AI marks and audio tracing" },
            { name: "Video Seal", use: "AI marks and image tracing" },
            { name: "DINOv2", use: "Reused images" },
            { name: "FAISS", use: "Voice, text and image search" },
            { name: "PyTorch", use: "The ML container" },
            { name: "React Native", use: "The victim's app" },
            { name: "React", use: "Console and portal" },
          ],
        },
      ],
      agentsLabel: "Agents",
      diagramNote:
        "The dotted line skips Meta's models: the voiceprint uses ECAPA, an open third-party model. Signals join a single cord, and the agents read from it.",
      approves: "Approves",
      agents: [
        { name: "Linker", what: "Explains each possible link", approves: "The reviewer" },
        { name: "Cartographer", what: "Analyzes a network", approves: "An analyst" },
        { name: "Lookout", what: "Drafts alerts by district", approves: "The team" },
        { name: "Writer", what: "Builds the case file", approves: "An analyst" },
        { name: "Advisor", what: "Writes advice by area", approves: "The team" },
        { name: "Authenticity", what: "Looks for signs of AI", approves: "The reviewer" },
      ],
    },
    results: { title: "What we measured." },
    pilot: {
      title: "Request access for your institution.",
      steps: [
        { lead: "First,", text: "we talk with your institution." },
        { lead: "Then,", text: "we do the legal review before handling real data." },
        { lead: "Finally,", text: "we start in one or two districts." },
      ],
    },
    foot: {
      callLine: "Call 105",
      reportLine: "To report, Línea 1818",
      top: "Back to top",
      creditsLabel: "Photos",
      place: "Lima, 2026",
      photosLabel: "Photos from Wikimedia Commons",
      photos: [
        { what: "mototaxis in central Lima", author: "Paulo Guereta", license: "CC BY 2.0", href: "https://commons.wikimedia.org/wiki/File:Lima_-_Per%C3%BA_(20529612568).jpg" },
        { what: "a hillside neighborhood in Lima", author: "moctezuma nacario", license: "CC BY 3.0", href: "https://commons.wikimedia.org/wiki/File:26_De_Mayo,_Distrito_de_Lima,_Peru_-_panoramio.jpg" },
        { what: "a corner shop in Lima", author: "cemeiakano", license: "CC BY-SA 2.0", href: "https://commons.wikimedia.org/wiki/File:Lima2011_-_bodega.jpg" },
      ],
      photosNote: "Cropped and resized for the web. They are illustrative: they show no victims and no places where cases happened",
    },
  },
};
