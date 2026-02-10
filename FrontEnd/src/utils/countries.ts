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

/**
 * Helper to get flag emoji from country name (case-insensitive)
 * Returns a white flag 🏳️ if not found.
 */
export const getCountryFlag = (nationality?: string): string => {
    if (!nationality) return "🏳️";
    
    // Normalize input
    const normalized = nationality.trim().toLowerCase();
    
    // Direct match
    const country = COUNTRIES.find(c => c.name.toLowerCase() === normalized);
    if (country) return country.flag;

    // Common aliases mapping (basic)
    const aliases: Record<string, string> = {
        "usa": "🇺🇸",
        "uk": "🇬🇧",
        "uae": "🇦🇪",
        "ksa": "🇸🇦",
        "korea": "🇰🇷",
    };

    return aliases[normalized] || "🏳️";
};
