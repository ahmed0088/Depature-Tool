// ═══════════════════════════════════════════════════════════
//  natguess.js  —  Nationality guessing from guest names
//  Add more names to NAT_MAP to improve accuracy
// ═══════════════════════════════════════════════════════════

const NAT_MAP = {
  turkey:       ['yesilkaya','bugra','yalcin','uluturk','sahin','oner','furkan','karatas','demir','kaya','celik','aydin','ozturk','yilmaz','arslan','koc','aktas','polat','ozcan','erdogan','tekin','aslan','cakmak','gul','sari','yildiz','ciftci','guler','acar','simsek','bayrak','bulut','dogan','kurt','topcu','ozdemir','aksoy','gumus','engin','samet','yesil','kilic','erdem','avci','koray','tunc','ozkan','sezer','duman'],
  india:        ['kuriakose','ajay','rajasegar','ranjith','latheef','ajmal','chandran','niyas','sulthan','moradiya','sanjay','shanmuganathan','nagamani','panchily','kumar','patel','singh','sharma','reddy','nair','menon','pillai','iyer','krishnan','venkat','suresh','ramesh','mahesh','rajesh','pradeep','sandeep','deepak','arun','vijay','anand','prakash','ravi','siva','bala','murugan','selvam','subramanian','venkatesan','natarajan','lokhandwala','dhanak','jain','mehta','joshi','desai','trivedi','bhatt','gandhi','vidhate','agarwal','gupta','verma','yadav','mishra','tiwari','dubey','bansal','kapoor','malhotra','chopra'],
  pakistan:     ['hasan','anis','ullah','farhan','khalid','faheem','syed','muhammad','jabbar','memon','khan','kamran','karim','malik','chaudhry','mirza','baig','qureshi','butt','rana','javed','tariq','asif','imran','usman','bilal','talha','zubair','waheed','rashid','nasir','zafar','tahir','waqar','akhtar','shahid','sajid','naveed','arshad','iftikhar','shabbir','ashfaq','riaz'],
  ethiopia:     ['demoz','rahwa','defersha','gebremeskel','nagash','getahun','tesfaye','abebe','haile','tadesse','bekele','girma','wolde','gebre','desta','alemu','mesfin','tsegay','mulugeta','berhe','tekle','hadgu','hagos','girmay','abreha','yemane','kibrom','berhane','alemayehu','fisseha','tigist','yohannes','meseret','birhanu','teshome','solomon','getachew','asefa','worku','negash','kassa','ayele','fikru','melaku'],
  philippines:  ['dela','santos','reyes','garcia','cruz','ramos','aquino','bautista','dizon','castillo','francisco','flores','bernardo','pascual','morales','gonzales','torres','natividad','soriano','villanueva','lim','tan','co','ang','sy','chua','go','uy','lee','yap','ong'],
  somalia:      ['osman','fathia','istarlin','jama','abdulkadir','saynab','sahra','mariam','muna','jimale','maryan','farah','aden','warsame','hirsi','salah','yusuf','dahir','hersi','shire','guled','bile','elmi','ismail','duale','hawo','halima','hodan','ifrah','nimo','nasra','abdikadir','mohamud','abdullahi','abdirahman','abdulahi','abdiaziz','abdinasir','hawade'],
  yemen:        ['alawlaqi','qahtan','ezzi','mutahara','abdulqader','almaashari','adhban','alhaddad','alqadhi','aleryani','alkohali','almakki','alnono','alrubaidi','alsanabani','althobhani','alwazeer'],
  guinea:       ['hamadou','diallo','youba','magassa','siby','oushamata','alhassane','fodie','bah','barry','camara','conde','toure','keita','kouyate','traore','sylla','soumah','bangoura'],
  algeria:      ['gacem','hicham','aissani','kamel','seloubi','chetta','hossem','boumediene','benali','benaissa'],
  uzbekistan:   ['sardor','azimov','saidazimkhon','mukhutdinov','arabov','navruz','kurbonov','umidjon','firdavs','mukhidov','umedzhon','mirzayev','yusupov','saidmakhmudov','akramov','qurbonjon','jasur','bekzod','shohruh','dilshod','otabek','jahongir','tursunov','rakhimov','ergashev','kholmatov'],
  russia:       ['magomadov','aiub','nabiev','ulugbek','ivanov','petrov','sidorov','smirnov','kuznetsov','popov','beterbiev','shibilov','volkov','sokolov','lebedev','kozlov','novikov','morozov','egorov','pavlov','stepanov','nikolaev','orlov','makarov','andreev','kovalev'],
  bangladesh:   ['morshed','chowdhury','rahman','akter','begum','sultana','hossain','islam','uddin','miah'],
  angola:       ['mulungo','tania','silva','sousa','ferreira','costa','santos','rodrigues'],
  mozambique:   ['manhique','nilza','mahomed','saucate','uqueio','mondlane','massinga','matsinhe','juliasse','machava','cossa','chissano','sitoe','nhantumbo','macuacua','langa','tembe'],
  senegal:      ['coundoul','mbaye','thiam','bocar','seck','niang','moda','diop','fall','gueye','faye','diouf','toure','sy','ba','lo','sarr','ndoye','thiaw','ndiaye','mbacke','serigne','koita','cisse','sow','dieng','sane','badji','goudiaby'],
  ghana:        ['ruwaida','sumaila','abubakari','balure','bashiru','nyamah','sylvester','mensah','asante','boateng','acheampong','owusu','amoah','darko','opoku','appiah','ofori'],
  egypt:        ['dhiaa','ghasan','fathy','zohairy','ibrahim','mahmoud','sayed','mostafa','khaled','walid','amr','tamer','sherif','ashraf'],
  morocco:      ['chouini','issam','jaid','benali','benmoussa','benomar','benziane','chaoui','chraibi','elalami','elfassi'],
  'saudi arabia':['alqahtani','alharbi','abdalmajeed','alghamdi','alshehri','alahmadi','alotaibi','albalawi'],
  uae:          ['alsaiari','alghanemi','alnuaimi','almazrouei','alkaabi','almansoori','almheiri','alketbi','alshehhi'],
  nigeria:      ['adeyemi','adewale','adebayo','adesola','balogun','chukwu','emeka','okafor','okonkwo','eze','igwe','nwachukwu'],
  kenya:        ['kamau','wanjiku','mwangi','njoroge','kariuki','gitau','ndungu','mugo','kinyua'],
  china:        ['zhang','huang','liang','zheng','jiang','xiao','feng','deng','zhong','tang','peng','cheng','wenjun','xiaoming'],
};

// Surnames too short for the ≥5 rule below but distinctive enough that an
// exact whole-word match is safe on its own. Kept deliberately small: every
// entry here bypasses the length guard that stops common words like 'ali'
// or 'khan' matching half the guest list.
const SHORT_NAT_MAP = {
  china: ['wang','zhao','chen','yang','zhou','wu','xu','shen','song','cao','pan','wei','fang','yuan','lu','duan'],
  japan: ['sato','suzuki','tanaka','ito','nakamura','kobayashi','yamada','sasaki'],
  korea: ['kim','park','choi','jung','kang','yoon','jang','lim'],
};

// Names that look like a country hint but are the wrong length or too
// ambiguous to trust are simply left unanswered — an honest blank beats a
// confident wrong answer, because the desk checks a blank and accepts a
// filled-in value.
function _natLabel(nat) {
  if (nat === 'uae') return 'UAE';
  return nat.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function guessNat(name) {
  if (!name) return '';
  const l     = name.toLowerCase().replace(/[^a-z\s]/g, '');
  const words = l.split(/\s+/).filter(w => w.length >= 4);
  // Pass 0 — the curated short list, exact whole-word only. Uses every word,
  // not just those ≥4 chars, since these surnames are often 2–3 letters.
  const allWords = l.split(/\s+/).filter(Boolean);
  for (const [nat, keys] of Object.entries(SHORT_NAT_MAP)) {
    if (keys.some(k => allWords.includes(k))) return _natLabel(nat);
  }

  // Pass 1 — exact whole-word match on keys ≥5 chars
  // A key like 'ali' or 'khan' is too common; require ≥5 to avoid cross-matches
  for (const [nat, keys] of Object.entries(NAT_MAP)) {
    for (const k of keys) {
      if (k.length < 5) continue;
      if (words.includes(k)) {
        return _natLabel(nat);
      }
    }
  }

  // Pass 2 — prefix match: key is the start of a word, both must be ≥6 chars
  for (const [nat, keys] of Object.entries(NAT_MAP)) {
    for (const k of keys) {
      if (k.length < 6) continue;
      if (words.some(w => w.length >= 6 && w.startsWith(k))) {
        return _natLabel(nat);
      }
    }
  }

  // Pass 3 — substring fallback only for long keys (≥7) to avoid common-word collisions
  for (const [nat, keys] of Object.entries(NAT_MAP)) {
    for (const k of keys) {
      if (k.length >= 7 && l.includes(k)) {
        return _natLabel(nat);
      }
    }
  }
  return '';
}

// ═══════════════════════════════════════════════════════════
//  Gender guessing from a guest's GIVEN name
//  Used only as a fallback when no title (Mr./Mrs./Ms.) is available
//  (e.g. Inhouse.xml has no gender/title field at all — only names).
//  This is inherently a guess, never treated as confirmed — the UI
//  must always mark it lower-confidence than a title-based match and
//  tell the desk to verify against the passport/ID in hand.
//  Add more names to either set to improve coverage.
// ═══════════════════════════════════════════════════════════

const GENDER_MALE_NAMES = new Set([
  // seen directly in this property's guest data
  'gert','jamoliddin','bashar','abdulaziz','alaaeldin','muaz','ahmad','ahmed','noah','mattia',
  'suhajb','suhayb','shresth','tarun','daler','mohamed','mohammed','esam','isam','shiju','ramesh',
  'parshotam','ruslan','sonny','abdulkadir','abdishakur','abubakar','abdurrahman','ibrahim',
  'nabeel','danial','osvaldo','khalfan','anwar','hisham','younas','yunus','rahul','maulik',
  'khadim','dmitrii','abdul','mukhammad','hashim','troy','florin','arie','dahir','haissam',
  'haitham','michael','ismail','vincent','alain','huseyin','hussein',
  // Turkish
  'mehmet','mustafa','ahmet','ali','hasan','omer','emre','burak','kaan','furkan','yusuf','emin',
  'serkan','volkan','tolga','murat','can','baris','ozan',
  // Indian
  'raj','rajesh','suresh','vijay','anand','prakash','ravi','amit','sanjay','deepak','arun','sunil',
  'manoj','sandeep','ashok','ajay','vikram','rohit','nikhil','karan','aditya','sanjeev','naveen',
  'pradeep','kumar','siva','bala','murugan','venkatesan','natarajan','krishnan','venkat','mahesh',
  // Pakistani
  'farhan','khalid','faheem','kamran','karim','tariq','asif','imran','usman','bilal','talha',
  'zubair','waheed','rashid','nasir','zafar','tahir','waqar','junaid','adeel','syed','muhammad',
  // Ethiopian
  'tesfaye','abebe','haile','tadesse','bekele','girma','wolde','desta','alemu','mesfin','mulugeta',
  'berhe','tekle','hagos','yohannes','dawit','solomon','kidane',
  // Filipino
  'jose','juan','mark','john','ramon','rodel','ferdinand','ricardo','danilo','rogelio','renato',
  // Somali
  'jama','jimale','farah','aden','warsame','hirsi','dahir','hersi','shire','guled','bile','elmi','duale',
  // Arabic / Gulf broader
  'hussein','omar','abdullah','abdulrahman','yousef','suleiman','sulaiman','hamza','zaid','fahad',
  'nasser','saeed','majed','tarek','sami','nabil','jamal','kamal','adel','adnan','anas','yasir',
  'yaser','marwan','emad','fadi','ziad','salem','hatem','rami','sultan','talal','turki','zayed',
  'mahmoud','mostafa','amr','sherif','ashraf','tamer','walid','faisal','waleed','yasser','khaled',
  'hossam','said','rachid','hicham','issam','youssef',
  // Senegalese / Guinean
  'mamadou','ibrahima','alpha','oumar','cheikh','modou','ousmane','moussa','abdou','souleymane',
  'boubacar','amadou',
  // Central Asian / Russian
  'sardor','umidjon','firdavs','bekzod','jasur','sherzod','otabek','bakhtiyor','ivan','dmitri',
  'alexei','sergei','andrei','nikolai','vladimir','pavel','anton','maxim',
  // Bangladeshi
  'rakib','rafiq','shakib','arif','jahangir',
  // Portuguese (Angola/Mozambique)
  'joao','manuel','antonio','carlos','paulo','pedro','miguel','fernando',
  // Ghanaian
  'kwame','kofi','kwabena','yaw','kwesi','kojo',
  // Nigerian
  'chinedu','emeka','ikechukwu','uche','chibuike','olumide','adewale','tunde','segun','femi',
  // Kenyan
  'kamau','mwangi','njoroge','kariuki','kimani','otieno','omondi',
]);

const GENDER_FEMALE_NAMES = new Set([
  // seen directly in this property's guest data
  'nazik','sahra','nadia','intisar','nimo','nouha','nuha','ruqaiya','alwiyah','alawiya','sandrine',
  'catherine','nurten','lucineide','xiaoyan','gertrudes','fathiya','fathia','mulki','amina','yusur',
  'sundus','saarah','sarah','elaf',
  // Turkish
  'ayse','fatma','emine','hatice','zeynep','elif','merve','esra','busra','ozge','sibel','derya',
  'sevgi','sevil','gulsah','aylin',
  // Indian
  'priya','anita','sunita','kavita','pooja','neha','meera','radha','sita','geeta','rekha','shanti',
  'lakshmi','divya','swati','anjali','sneha','kiran','deepa','nisha',
  // Pakistani
  'ayesha','sana','sadia','fariha','rabia','sadaf','shazia','uzma','farah','bushra',
  // Ethiopian
  'selam','meron','hirut','aster','tigist','bethlehem','rahel','genet','almaz','marta','konjit','wubit',
  // Filipino
  'maria','ana','rosa','marites','josephine','angelica','cristina','grace','joy','melody','precious',
  // Somali
  'fathia','istarlin','saynab','mariam','muna','maryan','hawo','halima','hodan','ifrah','nasra',
  'amran','deqa','ubax',
  // Arabic broader
  'fatima','aisha','zainab','layla','laila','noor','nour','huda','amal','rania','dalia','rana',
  'lina','maha','reem','samira','yasmin','yasmine','salma','hana','iman','hind','ghada','nada',
  'wafa','suha','sawsan','amira','dina','rasha','randa','hadeel','alaa','buthaina','manal','khadija',
  'imane','heba','nourhan','maryam','sara',
  // Senegalese / Guinean
  'aminata','fatoumata','mariama','coumba','awa','khady','ndeye','ramatoulaye',
  // Central Asian / Russian
  'nilufar','gulnora','dilnoza','sevara','zarina','elena','olga','natalia','irina','tatiana',
  'svetlana','anna','ekaterina','yulia',
  // Bangladeshi
  'sultana','nasrin','shirin','farzana',
  // Portuguese (Angola/Mozambique)
  'isabel','teresa','luisa',
  // Ghanaian
  'ama','akosua','abena','efua','adjoa',
  // Egyptian / Moroccan
  'mona','rana','yasmin',
  // Nigerian
  'ngozi','chioma','amaka','ifeoma','blessing','chidinma',
  // Kenyan
  'wanjiku','njeri','achieng','wangari','akinyi',
]);

// Returns 'M' | 'F' | '' — only ever a heuristic guess from the given name.
// Always surface this to staff as "guess — verify against ID", never as fact.
function guessGender(givenName) {
  if (!givenName) return '';
  const first = givenName.toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/)[0];
  if (!first) return '';
  if (GENDER_MALE_NAMES.has(first)) return 'M';
  if (GENDER_FEMALE_NAMES.has(first)) return 'F';
  return '';
}

