"""Bilingual vocabulary: ISL fingerspelling, counter phrases, sentence assembly.

The classifier recognises *signs*. This module turns signs into something a
counter clerk can act on:

* ``LetterBuffer`` accumulates committed fingerspelled letters into words, and
  words into a sentence, exactly as a signer pauses between them.
* ``COUNTER_PHRASES`` maps the keywords a citizen is most likely to spell at a
  railway / police / post-office / government counter onto a full, polite
  sentence in both English and Hindi -- so the clerk hears a sentence, not
  "T I C K E T".
* ``QUICK_CARDS`` is the accessibility fallback: if signing fails (bad lighting,
  an unusual handshape, a signer who is not fluent), the citizen taps a picture
  card and the same sentence is spoken. A translator that fails silently is
  worse than no translator at all.

Language note: handshape descriptions are deliberately *not* invented here.
Sign descriptions must come from the ISLRTC dictionary or a Deaf consultant --
see docs/LIMITATIONS.md.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence

ALPHABET: List[str] = [chr(c) for c in range(ord("A"), ord("Z") + 1)]
DIGITS: List[str] = [str(d) for d in range(10)]
FINGERSPELL_CLASSES: List[str] = ALPHABET + DIGITS


@dataclass(frozen=True)
class Phrase:
    """One thing a citizen might need to say at a counter."""

    id: str
    en: str
    hi: str
    hi_translit: str
    domain: str
    # Keywords that, when fingerspelled, resolve to this phrase.
    keywords: tuple[str, ...] = ()
    emoji: str = ""

    def __post_init__(self) -> None:
        """Coerce and validate ``keywords``.

        ``keywords=("platform")`` is the *string* ``"platform"`` -- iterating it
        yields single letters, so spelling the letter "O" alone would have
        announced "Where is the platform?". Guard against that permanently.
        """
        raw = self.keywords
        if isinstance(raw, str):
            raw = (raw,)
        cleaned = tuple(str(k).strip() for k in raw if str(k).strip())
        object.__setattr__(self, "keywords", cleaned)
        for k in cleaned:
            if len(k) < 2:
                raise ValueError(
                    f"phrase {self.id!r} has the single-character keyword {k!r}; "
                    "that is almost certainly an un-tupled string"
                )


@dataclass(frozen=True)
class Domain:
    id: str
    label_en: str
    label_hi: str
    emoji: str


DOMAINS: List[Domain] = [
    Domain("railway", "Railway counter", "रेलवे काउंटर", "🚆"),
    Domain("police", "Police station", "पुलिस थाना", "🚔"),
    Domain("post", "Post office", "डाकघर", "📮"),
    Domain("government", "Government office", "सरकारी कार्यालय", "🏛️"),
    Domain("general", "Any counter", "कोई भी काउंटर", "🗣️"),
]


# --------------------------------------------------------------------------- #
# The phrase book. Hindi is written in Devanagari for TTS; ``hi_translit`` is
# only for judges/readers who cannot read the script.
# --------------------------------------------------------------------------- #
COUNTER_PHRASES: List[Phrase] = [
    # ---- universal ----------------------------------------------------------
    Phrase("help", "I need help.", "मुझे मदद चाहिए।", "Mujhe madad chahiye.",
           "general", ("help", "helpme"), "🆘"),
    Phrase("deaf", "I am deaf. Please write it down for me.",
           "मैं बधिर हूँ। कृपया लिखकर बताइए।", "Main badhir hoon. Kripya likhkar bataiye.",
           "general", ("deaf", "iamdeaf"), "🧏"),
    Phrase("write", "Please write your answer down.", "कृपया अपना उत्तर लिखकर दीजिए।",
           "Kripya apna uttar likhkar dijiye.", "general", ("write", "paper"), "✍️"),
    Phrase("slow", "Please speak slowly.", "कृपया धीरे बोलिए।", "Kripya dheere boliye.",
           "general", ("slow", "slowly"), "🐢"),
    Phrase("repeat", "Please say that again.", "कृपया फिर से कहिए।", "Kripya phir se kahiye.",
           "general", ("repeat", "again"), "🔁"),
    Phrase("dont_understand", "I did not understand.", "मैं नहीं समझा।", "Main nahi samjha.",
           "general", ("dontunderstand", "nounderstand"), "❓"),
    Phrase("thanks", "Thank you.", "धन्यवाद।", "Dhanyavaad.", "general", ("thanks", "thankyou"), "🙏"),
    Phrase("yes", "Yes.", "हाँ।", "Haan.", "general", ("yes",), "✅"),
    Phrase("no", "No.", "नहीं।", "Nahi.", "general", ("no",), "⛔"),
    Phrase("water", "Please give me some water.", "कृपया मुझे पानी दीजिए।",
           "Kripya mujhe paani dijiye.", "general", ("water", "drink"), "💧"),
    Phrase("toilet", "Where is the toilet?", "शौचालय कहाँ है?", "Shauchalay kahaan hai?",
           "general", ("toilet", "washroom", "restroom"), "🚻"),
    Phrase("doctor", "I need a doctor.", "मुझे डॉक्टर चाहिए।", "Mujhe doctor chahiye.",
           "general", ("doctor", "sick", "medicine"), "⚕️"),
    Phrase("name", "My name is", "मेरा नाम है", "Mera naam hai", "general", ("name", "myname"), "🪪"),

    # ---- railway ------------------------------------------------------------
    Phrase("ticket", "I want to buy a ticket.", "मुझे टिकट खरीदना है।", "Mujhe ticket khareedna hai.",
           "railway", ("ticket", "buyticket"), "🎫"),
    Phrase("platform", "Where is the platform?", "प्लेटफ़ॉर्म कहाँ है?", "Platform kahaan hai?",
           "railway", ("platform",), "🚉"),
    Phrase("train_time", "What time does my train leave?", "मेरी ट्रेन किस समय जाएगी?",
           "Meri train kis samay jaayegi?", "railway", ("traintime", "departure", "time"), "⏰"),
    Phrase("train_late", "My train is delayed.", "मेरी ट्रेन देरी से है।", "Meri train deri se hai.",
           "railway", ("late", "delayed", "delay"), "⌛"),
    Phrase("waiting_room", "Where is the waiting room?", "प्रतीक्षालय कहाँ है?",
           "Prateekshalay kahaan hai?", "railway", ("waitingroom", "waiting"), "🪑"),
    Phrase("luggage_lost", "I have lost my luggage.", "मेरा सामान खो गया है।",
           "Mera samaan kho gaya hai.", "railway", ("luggage", "bag", "lost"), "🧳"),
    Phrase("refund", "I want a refund on my ticket.", "मुझे टिकट का रिफ़ंड चाहिए।",
           "Mujhe ticket ka refund chahiye.", "railway", ("refund", "cancel"), "💰"),
    Phrase("enquiry", "Where is the enquiry counter?", "पूछताछ काउंटर कहाँ है?",
           "Poochhtaachh counter kahaan hai?", "railway", ("enquiry", "inquiry"), "ℹ️"),

    # ---- police -------------------------------------------------------------
    Phrase("complaint", "I want to file a complaint.", "मुझे शिकायत दर्ज करनी है।",
           "Mujhe shikayat darj karni hai.", "police", ("complaint", "fir", "report"), "📝"),
    Phrase("stolen", "Something of mine was stolen.", "मेरी कोई चीज़ चोरी हो गई है।",
           "Meri koi cheez chori ho gayi hai.", "police", ("stolen", "theft", "robbed"), "🚨"),
    Phrase("accident", "There has been an accident.", "एक दुर्घटना हुई है।",
           "Ek durghatna hui hai.", "police", ("accident",), "🚑"),
    Phrase("lost_document", "I have lost an important document.",
           "मेरा एक ज़रूरी दस्तावेज़ खो गया है।", "Mera ek zaroori dastavez kho gaya hai.",
           "police", ("lostdocument", "document"), "📄"),
    Phrase("unsafe", "I do not feel safe.", "मैं असुरक्षित महसूस कर रहा हूँ।",
           "Main asurakshit mehsoos kar raha hoon.", "police", ("unsafe", "scared", "danger"), "🛡️"),
    Phrase("witness", "I want to give a statement.", "मुझे बयान देना है।", "Mujhe bayaan dena hai.",
           "police", ("statement", "witness"), "🗨️"),

    # ---- post office --------------------------------------------------------
    Phrase("send_parcel", "I want to send a parcel.", "मुझे पार्सल भेजना है।",
           "Mujhe parcel bhejna hai.", "post", ("parcel", "post", "send"), "📦"),
    Phrase("postage", "How much is the postage?", "डाक शुल्क कितना है?", "Daak shulk kitna hai?",
           "post", ("postage", "charge", "fee", "cost"), "🪙"),
    Phrase("money_order", "I need a money order form.", "मुझे मनीऑर्डर फ़ॉर्म चाहिए।",
           "Mujhe money order form chahiye.", "post", ("moneyorder", "money"), "💸"),
    Phrase("stamp", "I want to buy stamps.", "मुझे डाक टिकट खरीदनी है।",
           "Mujhe daak ticket khareedni hai.", "post", ("stamp", "stamps"), "📬"),
    Phrase("address", "I need help writing this address.",
           "मुझे यह पता लिखने में मदद चाहिए।", "Mujhe yeh pata likhne mein madad chahiye.",
           "post", ("address",), "🏠"),
    Phrase("speed_post", "I want to send this by speed post.",
           "मुझे यह स्पीड पोस्ट से भेजना है।", "Mujhe yeh speed post se bhejna hai.",
           "post", ("speedpost", "express"), "⚡"),

    # ---- government ---------------------------------------------------------
    Phrase("aadhaar", "I need help with my Aadhaar.", "मुझे आधार में मदद चाहिए।",
           "Mujhe Aadhaar mein madad chahiye.", "government", ("aadhaar", "aadhar"), "🪪"),
    Phrase("pan", "I need help with my PAN card.", "मुझे पैन कार्ड में मदद चाहिए।",
           "Mujhe PAN card mein madad chahiye.", "government", ("pan", "pancard"), "💳"),
    Phrase("certificate", "I want to apply for a certificate.",
           "मुझे प्रमाणपत्र के लिए आवेदन करना है।", "Mujhe pramanpatra ke liye aavedan karna hai.",
           "government", ("certificate", "apply"), "📜"),
    Phrase("pension", "I want to ask about my pension.", "मुझे अपनी पेंशन के बारे में पूछना है।",
           "Mujhe apni pension ke baare mein poochhna hai.", "government", ("pension",), "👵"),
    Phrase("bill", "I want to pay a bill.", "मुझे बिल जमा करना है।", "Mujhe bill jama karna hai.",
           "government", ("bill", "pay"), "🧾"),
    Phrase("form", "I need a form.", "मुझे फ़ॉर्म चाहिए।", "Mujhe form chahiye.",
           "government", ("form",), "📋"),
    Phrase("ration", "I want to ask about my ration card.",
           "मुझे अपने राशन कार्ड के बारे में पूछना है।", "Mujhe apne ration card ke baare mein poochhna hai.",
           "government", ("ration",), "🌾"),
    Phrase("officer", "Please call an officer.", "कृपया किसी अधिकारी को बुलाइए।",
           "Kripya kisi adhikaari ko bulaiye.", "government", ("officer", "manager"), "👮"),
]


PHRASES_BY_ID: Dict[str, Phrase] = {p.id: p for p in COUNTER_PHRASES}

# Keyword -> phrase index, built once. Keywords are compared with punctuation and
# spaces stripped, so "waiting room" matches a spelled "WAITINGROOM".
_KEYWORD_INDEX: Dict[str, Phrase] = {}
for _p in COUNTER_PHRASES:
    for _k in _p.keywords:
        _KEYWORD_INDEX[_k.replace(" ", "").upper()] = _p


def lookup_phrase(word: str) -> Optional[Phrase]:
    """Resolve a fingerspelled word to a whole phrase, if we know it."""
    if not word:
        return None
    key = "".join(ch for ch in word.upper() if ch.isalnum())
    return _KEYWORD_INDEX.get(key)


def phrases_for_domain(domain: str | None) -> List[Phrase]:
    """Phrase cards for a domain, plus the universal ones (always relevant)."""
    if not domain or domain == "general":
        return list(COUNTER_PHRASES)
    return [p for p in COUNTER_PHRASES if p.domain in (domain, "general")]


# --------------------------------------------------------------------------- #
# Sentence assembly
# --------------------------------------------------------------------------- #
@dataclass
class LetterBuffer:
    """Turns a stream of committed signs into readable text.

    Behaviour:

    * letters/digits accumulate into the current word;
    * a pause (rest gesture) flushes the word -- and if that word is a known
      keyword, the whole polite phrase is substituted, so spelling ``TICKET``
      announces "I want to buy a ticket" rather than six letters;
    * ``reset()`` starts a new utterance.
    """

    letters: List[str] = field(default_factory=list)
    words: List[str] = field(default_factory=list)
    resolved: List[Phrase] = field(default_factory=list)
    last_committed: Optional[str] = None

    def commit(self, sign: str) -> Optional[Phrase]:
        """Add one committed sign. Returns a Phrase when a keyword completed."""
        sign = sign.upper()
        if sign in FINGERSPELL_CLASSES:
            self.letters.append(sign)
            self.last_committed = sign
            return None
        # Non-alphabet signs (future whole-word signs) flush and attach directly.
        self.flush()
        self.last_committed = sign
        return None

    def flush(self) -> Optional[Phrase]:
        """Close the current word; resolve it to a phrase if it is a keyword."""
        if not self.letters:
            return None
        word = "".join(self.letters)
        self.letters = []
        phrase = lookup_phrase(word)
        if phrase is not None:
            self.resolved.append(phrase)
            self.words.append(phrase.en)
        else:
            self.words.append(word)
        return phrase

    # ------------------------------------------------------------------ #
    @property
    def pending(self) -> str:
        """The word currently being spelled (shown live in the UI)."""
        return "".join(self.letters)

    def text_en(self) -> str:
        parts = list(self.words)
        if self.letters:
            parts.append("".join(self.letters) + "_")
        return " ".join(parts).strip()

    def text_hi(self) -> str:
        parts: List[str] = []
        for w in self.words:
            match = next((p for p in COUNTER_PHRASES if p.en == w), None)
            parts.append(match.hi.rstrip("।.") if match else w)
        if self.letters:
            parts.append("".join(self.letters))
        return " ".join(parts).strip()

    def last_phrase(self) -> Optional[Phrase]:
        return self.resolved[-1] if self.resolved else None

    def reset(self) -> None:
        self.letters.clear()
        self.words.clear()
        self.resolved.clear()
        self.last_committed = None

    def __len__(self) -> int:
        return len(self.words) + (1 if self.letters else 0)


def describe_sign(sign: str) -> str:
    """Human-readable description of a single committed sign, for the UI overlay."""
    s = sign.upper()
    if s in ALPHABET:
        return f"ISL fingerspelling letter “{s}”"
    if s in DIGITS:
        return f"ISL numeral “{s}”"
    return f"ISL sign “{s}”"


def domain_of(domain_id: str) -> Optional[Domain]:
    return next((d for d in DOMAINS if d.id == domain_id), None)


def all_sign_labels() -> Sequence[str]:
    """Every sign the shipped model can produce, in display order."""
    return FINGERSPELL_CLASSES
