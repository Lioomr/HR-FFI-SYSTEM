/**
 * List of countries with their ISO codes and flag emojis.
 * sorted by common usage or alphabetically
 */
export interface Country {
    name: string;
    code: string;
    flag: string;
}

export const COUNTRIES: Country[] = [
    { name: "Saudi Arabia", code: "SA", flag: "🇸🇦" },
    { name: "United Arab Emirates", code: "AE", flag: "🇦🇪" },
    { name: "Kuwait", code: "KW", flag: "🇰🇼" },
    { name: "Qatar", code: "QA", flag: "🇶🇦" },
    { name: "Bahrain", code: "BH", flag: "🇧🇭" },
    { name: "Oman", code: "OM", flag: "🇴🇲" },
    { name: "United States", code: "US", flag: "🇺🇸" },
    { name: "United Kingdom", code: "GB", flag: "🇬🇧" },
    { name: "Canada", code: "CA", flag: "🇨🇦" },
    { name: "India", code: "IN", flag: "🇮🇳" },
    { name: "Pakistan", code: "PK", flag: "🇵🇰" },
    { name: "Philippines", code: "PH", flag: "🇵🇭" },
    { name: "Egypt", code: "EG", flag: "🇪🇬" },
    { name: "Jordan", code: "JO", flag: "🇯🇴" },
    { name: "Lebanon", code: "LB", flag: "🇱🇧" },
    { name: "Syria", code: "SY", flag: "🇸🇾" },
    { name: "Iraq", code: "IQ", flag: "🇮🇶" },
    { name: "Yemen", code: "YE", flag: "🇾🇪" },
    { name: "Sudan", code: "SD", flag: "🇸🇩" },
    { name: "Morocco", code: "MA", flag: "🇲🇦" },
    { name: "Tunisia", code: "TN", flag: "🇹🇳" },
    { name: "Algeria", code: "DZ", flag: "🇩🇿" },
    { name: "Germany", code: "DE", flag: "🇩🇪" },
    { name: "France", code: "FR", flag: "🇫🇷" },
    { name: "Italy", code: "IT", flag: "🇮🇹" },
    { name: "Spain", code: "ES", flag: "🇪🇸" },
    { name: "Australia", code: "AU", flag: "🇦🇺" },
    { name: "New Zealand", code: "NZ", flag: "🇳🇿" },
    { name: "China", code: "CN", flag: "🇨🇳" },
    { name: "Japan", code: "JP", flag: "🇯🇵" },
    { name: "South Korea", code: "KR", flag: "🇰🇷" },
    { name: "Singapore", code: "SG", flag: "🇸🇬" },
    { name: "Malaysia", code: "MY", flag: "🇲🇾" },
    { name: "Indonesia", code: "ID", flag: "🇮🇩" },
    { name: "Bangladesh", code: "BD", flag: "🇧🇩" },
    { name: "Sri Lanka", code: "LK", flag: "🇱🇰" },
    { name: "Nepal", code: "NP", flag: "🇳🇵" },
    { name: "Turkey", code: "TR", flag: "🇹🇷" },
    { name: "Ireland", code: "IE", flag: "🇮🇪" },
    { name: "South Africa", code: "ZA", flag: "🇿🇦" },
    { name: "Russia", code: "RU", flag: "🇷🇺" },
    { name: "Brazil", code: "BR", flag: "🇧🇷" },
    { name: "Mexico", code: "MX", flag: "🇲🇽" },
    { name: "Argentina", code: "AR", flag: "🇦🇷" },
];

const COUNTRY_BY_NAME = new Map(COUNTRIES.map((c) => [c.name.toLowerCase(), c]));
const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code.toLowerCase(), c]));

const COUNTRY_ALIASES: Record<string, string> = {
    usa: "US",
    uk: "GB",
    uae: "AE",
    ksa: "SA",
    korea: "KR",
    egyptian: "EG",
    saudi: "SA",
    saudia: "SA",
    saudiarabia: "SA",
    bengali: "BD",
    bangladeshi: "BD",
};

const DIAL_CODE_BY_ISO: Record<string, string> = {
    SA: "+966",
    AE: "+971",
    KW: "+965",
    QA: "+974",
    BH: "+973",
    OM: "+968",
    US: "+1",
    GB: "+44",
    CA: "+1",
    IN: "+91",
    PK: "+92",
    PH: "+63",
    EG: "+20",
    JO: "+962",
    LB: "+961",
    SY: "+963",
    IQ: "+964",
    YE: "+967",
    SD: "+249",
    MA: "+212",
    TN: "+216",
    DZ: "+213",
    DE: "+49",
    FR: "+33",
    IT: "+39",
    ES: "+34",
    AU: "+61",
    NZ: "+64",
    CN: "+86",
    JP: "+81",
    KR: "+82",
    SG: "+65",
    MY: "+60",
    ID: "+62",
    BD: "+880",
    LK: "+94",
    NP: "+977",
    TR: "+90",
    IE: "+353",
    ZA: "+27",
    RU: "+7",
    BR: "+55",
    MX: "+52",
    AR: "+54",
};

function codeToFlagEmoji(code: string): string {
    const upper = code.toUpperCase();
    if (!/^[A-Z]{2}$/.test(upper)) return "🏳️";
    const OFFSET = 127397;
    return String.fromCodePoint(...upper.split("").map((char) => char.charCodeAt(0) + OFFSET));
}

function normalizeCountryText(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

function resolveCountryCode(nationality?: string): string | null {
    if (!nationality) return null;

    const raw = nationality.trim();
    if (!raw) return null;
    const normalized = normalizeCountryText(raw);
    const compact = normalized.replace(/\s+/g, "");

    const byName = COUNTRY_BY_NAME.get(normalized);
    if (byName) return byName.code.toUpperCase();

    const byCode = COUNTRY_BY_CODE.get(compact);
    if (byCode) return byCode.code.toUpperCase();

    const prefixedCode = raw.match(/^\s*([A-Za-z]{2})\b/);
    if (prefixedCode) return prefixedCode[1].toUpperCase();

    for (const country of COUNTRIES) {
        if (normalized.includes(normalizeCountryText(country.name))) {
            return country.code.toUpperCase();
        }
    }

    const aliasCode = COUNTRY_ALIASES[normalized] || COUNTRY_ALIASES[compact];
    if (aliasCode) return aliasCode.toUpperCase();

    return null;
}

export const getCountryCode = (nationality?: string): string | null => {
    const code = resolveCountryCode(nationality);
    if (!code || !/^[A-Z]{2}$/.test(code)) return null;
    return code;
};

export const getCountryFlagImageUrl = (nationality?: string): string | null => {
    const code = getCountryCode(nationality);
    if (!code) return null;
    return `https://flagcdn.com/24x18/${code.toLowerCase()}.png`;
};

export const getDialCodeByNationality = (nationality?: string): string | null => {
    const code = getCountryCode(nationality);
    if (!code) return null;
    return DIAL_CODE_BY_ISO[code] || null;
};

export const getDialCodeByCountryCode = (countryCode?: string): string | null => {
    if (!countryCode) return null;
    return DIAL_CODE_BY_ISO[countryCode.toUpperCase()] || null;
};

/**
 * Helper to get flag emoji from country name (case-insensitive)
 * Returns a white flag 🏳️ if not found.
 */
export const getCountryFlag = (nationality?: string): string => {
    const code = resolveCountryCode(nationality);
    if (code) return codeToFlagEmoji(code);
    return "🏳️";
};
