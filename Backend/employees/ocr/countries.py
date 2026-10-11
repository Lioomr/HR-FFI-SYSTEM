"""ICAO 9303 / ISO 3166-1 alpha-3 country codes -> the English country names HR uses.

A passport MRZ carries nationality and issuing state as three-letter codes
("EGY"), but the employee profile stores a plain English country name
("Egypt"). Names follow the short, common forms already used across the app
(``FrontEnd/src/utils/countries.ts``, the employee importer): "Saudi Arabia",
"United States", "United Kingdom", "South Korea", "Russia", "Turkey", "Syria".

The table is static on purpose - no runtime dependency, and a code we do not
know is reported to HR instead of being guessed.
"""

from __future__ import annotations

import re

COUNTRY_NAMES_BY_CODE: dict[str, str] = {
    # --- Gulf and Arab states ---------------------------------------------
    "SAU": "Saudi Arabia",
    "ARE": "United Arab Emirates",
    "KWT": "Kuwait",
    "QAT": "Qatar",
    "BHR": "Bahrain",
    "OMN": "Oman",
    "YEM": "Yemen",
    "EGY": "Egypt",
    "JOR": "Jordan",
    "LBN": "Lebanon",
    "SYR": "Syria",
    "IRQ": "Iraq",
    "PSE": "Palestine",
    "SDN": "Sudan",
    "SSD": "South Sudan",
    "LBY": "Libya",
    "TUN": "Tunisia",
    "DZA": "Algeria",
    "MAR": "Morocco",
    "MRT": "Mauritania",
    "SOM": "Somalia",
    "DJI": "Djibouti",
    "COM": "Comoros",
    # --- South and Central Asia -------------------------------------------
    "IND": "India",
    "PAK": "Pakistan",
    "BGD": "Bangladesh",
    "LKA": "Sri Lanka",
    "NPL": "Nepal",
    "BTN": "Bhutan",
    "MDV": "Maldives",
    "AFG": "Afghanistan",
    "IRN": "Iran",
    "KAZ": "Kazakhstan",
    "KGZ": "Kyrgyzstan",
    "TJK": "Tajikistan",
    "TKM": "Turkmenistan",
    "UZB": "Uzbekistan",
    # --- East and South-East Asia -----------------------------------------
    "PHL": "Philippines",
    "IDN": "Indonesia",
    "MYS": "Malaysia",
    "SGP": "Singapore",
    "THA": "Thailand",
    "VNM": "Vietnam",
    "KHM": "Cambodia",
    "LAO": "Laos",
    "MMR": "Myanmar",
    "BRN": "Brunei",
    "TLS": "Timor-Leste",
    "CHN": "China",
    "HKG": "Hong Kong",
    "MAC": "Macau",
    "TWN": "Taiwan",
    "JPN": "Japan",
    "KOR": "South Korea",
    "PRK": "North Korea",
    "MNG": "Mongolia",
    # --- Africa -------------------------------------------------------------
    "ETH": "Ethiopia",
    "ERI": "Eritrea",
    "KEN": "Kenya",
    "UGA": "Uganda",
    "TZA": "Tanzania",
    "RWA": "Rwanda",
    "BDI": "Burundi",
    "NGA": "Nigeria",
    "GHA": "Ghana",
    "CMR": "Cameroon",
    "SEN": "Senegal",
    "MLI": "Mali",
    "NER": "Niger",
    "TCD": "Chad",
    "BFA": "Burkina Faso",
    "CIV": "Ivory Coast",
    "GIN": "Guinea",
    "GNB": "Guinea-Bissau",
    "GNQ": "Equatorial Guinea",
    "SLE": "Sierra Leone",
    "LBR": "Liberia",
    "GMB": "Gambia",
    "TGO": "Togo",
    "BEN": "Benin",
    "CPV": "Cape Verde",
    "STP": "Sao Tome and Principe",
    "GAB": "Gabon",
    "COG": "Republic of the Congo",
    "COD": "Democratic Republic of the Congo",
    "CAF": "Central African Republic",
    "AGO": "Angola",
    "ZMB": "Zambia",
    "ZWE": "Zimbabwe",
    "MWI": "Malawi",
    "MOZ": "Mozambique",
    "MDG": "Madagascar",
    "MUS": "Mauritius",
    "SYC": "Seychelles",
    "ZAF": "South Africa",
    "NAM": "Namibia",
    "BWA": "Botswana",
    "LSO": "Lesotho",
    "SWZ": "Eswatini",
    "ESH": "Western Sahara",
    "REU": "Reunion",
    "MYT": "Mayotte",
    "SHN": "Saint Helena",
    # --- Europe -------------------------------------------------------------
    "GBR": "United Kingdom",
    "IRL": "Ireland",
    "FRA": "France",
    "DEU": "Germany",
    "D": "Germany",  # ICAO: German passports use the single letter D.
    "ITA": "Italy",
    "ESP": "Spain",
    "PRT": "Portugal",
    "NLD": "Netherlands",
    "BEL": "Belgium",
    "LUX": "Luxembourg",
    "CHE": "Switzerland",
    "AUT": "Austria",
    "LIE": "Liechtenstein",
    "MCO": "Monaco",
    "AND": "Andorra",
    "SMR": "San Marino",
    "VAT": "Vatican City",
    "MLT": "Malta",
    "GRC": "Greece",
    "CYP": "Cyprus",
    "TUR": "Turkey",
    "ISR": "Israel",
    "DNK": "Denmark",
    "NOR": "Norway",
    "SWE": "Sweden",
    "FIN": "Finland",
    "ISL": "Iceland",
    "EST": "Estonia",
    "LVA": "Latvia",
    "LTU": "Lithuania",
    "POL": "Poland",
    "CZE": "Czech Republic",
    "SVK": "Slovakia",
    "HUN": "Hungary",
    "SVN": "Slovenia",
    "HRV": "Croatia",
    "BIH": "Bosnia and Herzegovina",
    "SRB": "Serbia",
    "MNE": "Montenegro",
    "MKD": "North Macedonia",
    "ALB": "Albania",
    "RKS": "Kosovo",  # ICAO code used on Kosovo passports.
    "XKX": "Kosovo",
    "BGR": "Bulgaria",
    "ROU": "Romania",
    "MDA": "Moldova",
    "UKR": "Ukraine",
    "BLR": "Belarus",
    "RUS": "Russia",
    "GEO": "Georgia",
    "ARM": "Armenia",
    "AZE": "Azerbaijan",
    "FRO": "Faroe Islands",
    "GRL": "Greenland",
    "GIB": "Gibraltar",
    "GGY": "Guernsey",
    "JEY": "Jersey",
    "IMN": "Isle of Man",
    "ALA": "Aland Islands",
    "SJM": "Svalbard and Jan Mayen",
    # --- Americas -----------------------------------------------------------
    "USA": "United States",
    "CAN": "Canada",
    "MEX": "Mexico",
    "GTM": "Guatemala",
    "BLZ": "Belize",
    "HND": "Honduras",
    "SLV": "El Salvador",
    "NIC": "Nicaragua",
    "CRI": "Costa Rica",
    "PAN": "Panama",
    "CUB": "Cuba",
    "JAM": "Jamaica",
    "HTI": "Haiti",
    "DOM": "Dominican Republic",
    "PRI": "Puerto Rico",
    "BHS": "Bahamas",
    "BRB": "Barbados",
    "TTO": "Trinidad and Tobago",
    "DMA": "Dominica",
    "GRD": "Grenada",
    "LCA": "Saint Lucia",
    "VCT": "Saint Vincent and the Grenadines",
    "KNA": "Saint Kitts and Nevis",
    "ATG": "Antigua and Barbuda",
    "COL": "Colombia",
    "VEN": "Venezuela",
    "GUY": "Guyana",
    "SUR": "Suriname",
    "ECU": "Ecuador",
    "PER": "Peru",
    "BOL": "Bolivia",
    "BRA": "Brazil",
    "PRY": "Paraguay",
    "URY": "Uruguay",
    "ARG": "Argentina",
    "CHL": "Chile",
    "ABW": "Aruba",
    "CUW": "Curacao",
    "SXM": "Sint Maarten",
    "BES": "Caribbean Netherlands",
    "AIA": "Anguilla",
    "BMU": "Bermuda",
    "CYM": "Cayman Islands",
    "VGB": "British Virgin Islands",
    "VIR": "United States Virgin Islands",
    "TCA": "Turks and Caicos Islands",
    "MSR": "Montserrat",
    "GLP": "Guadeloupe",
    "MTQ": "Martinique",
    "GUF": "French Guiana",
    "BLM": "Saint Barthelemy",
    "MAF": "Saint Martin",
    "SPM": "Saint Pierre and Miquelon",
    "FLK": "Falkland Islands",
    "SGS": "South Georgia and the South Sandwich Islands",
    # --- Oceania ------------------------------------------------------------
    "AUS": "Australia",
    "NZL": "New Zealand",
    "PNG": "Papua New Guinea",
    "FJI": "Fiji",
    "SLB": "Solomon Islands",
    "VUT": "Vanuatu",
    "WSM": "Samoa",
    "TON": "Tonga",
    "KIR": "Kiribati",
    "TUV": "Tuvalu",
    "NRU": "Nauru",
    "PLW": "Palau",
    "FSM": "Micronesia",
    "MHL": "Marshall Islands",
    "COK": "Cook Islands",
    "NIU": "Niue",
    "TKL": "Tokelau",
    "ASM": "American Samoa",
    "GUM": "Guam",
    "MNP": "Northern Mariana Islands",
    "NCL": "New Caledonia",
    "PYF": "French Polynesia",
    "WLF": "Wallis and Futuna",
    "NFK": "Norfolk Island",
    "PCN": "Pitcairn Islands",
    "CXR": "Christmas Island",
    "CCK": "Cocos (Keeling) Islands",
    "HMD": "Heard Island and McDonald Islands",
    "UMI": "United States Minor Outlying Islands",
    "IOT": "British Indian Ocean Territory",
    "ATF": "French Southern Territories",
    "ATA": "Antarctica",
    "BVT": "Bouvet Island",
    # --- ICAO 9303 special codes -------------------------------------------
    # British nationality variants all belong to the United Kingdom.
    "GBD": "United Kingdom",  # British Overseas Territories Citizen
    "GBN": "United Kingdom",  # British National (Overseas)
    "GBO": "United Kingdom",  # British Overseas Citizen
    "GBP": "United Kingdom",  # British Protected Person
    "GBS": "United Kingdom",  # British Subject
    "EUE": "European Union",
    "UNO": "United Nations",
    "UNA": "United Nations",
    "UNK": "Kosovo",  # UN Interim Administration Mission in Kosovo
    "XXA": "Stateless",
    "XXB": "Refugee",
    "XXC": "Refugee",
    # Deliberately absent: "XXX" (nationality unspecified) - HR must decide.
}

# Uppercased country name -> canonical spelling, so a printed "EGYPT" becomes "Egypt".
_COUNTRY_NAMES_BY_UPPER_NAME: dict[str, str] = {name.upper(): name for name in COUNTRY_NAMES_BY_CODE.values()}

_MRZ_CODE = re.compile(r"[A-Z]{1,3}")


def country_name(value: str) -> tuple[str, bool]:
    """Return ``(display value, recognised)`` for a nationality or issuing-state value.

    * A known MRZ code ("EGY", "D") becomes its English name ("Egypt", "Germany").
    * An already spelled country name in any case ("EGYPT") gets its canonical
      spelling ("Egypt").
    * Anything else is returned unchanged; ``recognised`` is False only when the
      value looks like an MRZ code we cannot map, so the caller can warn HR.
    """

    cleaned = " ".join((value or "").split())
    if not cleaned:
        return "", True
    upper = cleaned.upper()
    if upper in COUNTRY_NAMES_BY_CODE:
        return COUNTRY_NAMES_BY_CODE[upper], True
    spelled = _COUNTRY_NAMES_BY_UPPER_NAME.get(upper)
    if spelled:
        return spelled, True
    if _MRZ_CODE.fullmatch(upper):
        return cleaned, False
    return cleaned, True
