// ═══════════════════════════════════════════════════════════
//  natguess.js  —  Nationality guessing from guest names
//  Add more names to NAT_MAP to improve accuracy
// ═══════════════════════════════════════════════════════════

const NAT_MAP = {
  turkey:       ['yesilkaya','bugra','yalcin','uluturk','sahin','oner','furkan','karatas','demir','kaya','celik','aydin','ozturk','yilmaz','arslan','koc','aktas','polat','ozcan','erdogan','tekin','aslan','cakmak','gul','sari','yildiz','ciftci','guler','acar','simsek','bayrak','bulut','dogan','kurt','topcu','ozdemir','aksoy'],
  india:        ['kuriakose','ajay','rajasegar','ranjith','latheef','ajmal','chandran','niyas','sulthan','moradiya','sanjay','shanmuganathan','nagamani','panchily','kumar','patel','singh','sharma','reddy','nair','menon','pillai','iyer','krishnan','venkat','suresh','ramesh','mahesh','rajesh','pradeep','sandeep','deepak','arun','vijay','anand','prakash','ravi','siva','bala','murugan','selvam','subramanian','venkatesan','natarajan'],
  pakistan:     ['hasan','anis','ullah','farhan','khalid','faheem','syed','muhammad','jabbar','memon','khan','kamran','karim','malik','chaudhry','mirza','baig','qureshi','butt','rana','javed','tariq','asif','imran','usman','bilal','talha','zubair','waheed','rashid','nasir','zafar','tahir','waqar'],
  ethiopia:     ['demoz','rahwa','defersha','gebremeskel','nagash','getahun','tesfaye','abebe','haile','tadesse','bekele','girma','wolde','gebre','desta','alemu','mesfin','tsegay','mulugeta','berhe','tekle','hadgu','hagos','girmay','abreha','yemane','kibrom','berhane'],
  philippines:  ['dela','santos','reyes','garcia','cruz','ramos','aquino','bautista','dizon','castillo','francisco','flores','bernardo','pascual','morales','gonzales','torres','natividad','soriano','villanueva','lim','tan','co','ang','sy','chua','go','uy','lee','yap','ong'],
  somalia:      ['osman','fathia','istarlin','jama','abdulkadir','saynab','sahra','mariam','muna','jimale','maryan','farah','aden','warsame','hirsi','salah','yusuf','dahir','hersi','shire','guled','bile','elmi','ismail','duale','hawo','halima','hodan','ifrah','nimo','nasra'],
  yemen:        ['alawlaqi','qahtan','ezzi','mutahara','abdulqader','almaashari','adhban','alhaddad','alqadhi','aleryani','alkohali','almakki','alnono','alrubaidi','alsanabani','althobhani','alwazeer'],
  guinea:       ['hamadou','diallo','youba','magassa','siby','oushamata','alhassane','fodie','bah','barry','camara','conde','toure','keita','kouyate','traore','sylla','soumah','bangoura'],
  algeria:      ['gacem','hicham','aissani','kamel','seloubi','chetta','hossem','boumediene','benali','benaissa'],
  uzbekistan:   ['sardor','azimov','saidazimkhon','mukhutdinov','arabov','navruz','kurbonov','umidjon','firdavs','mukhidov','umedzhon','mirzayev','yusupov'],
  russia:       ['magomadov','aiub','nabiev','ulugbek','ivanov','petrov','sidorov','smirnov','kuznetsov','popov'],
  bangladesh:   ['morshed','chowdhury','rahman','akter','begum','sultana','hossain','islam','uddin','miah'],
  angola:       ['mulungo','tania','silva','sousa','ferreira','costa','santos','rodrigues'],
  mozambique:   ['manhique','nilza','mahomed','saucate','uqueio','mondlane','massinga'],
  senegal:      ['coundoul','mbaye','thiam','bocar','seck','niang','moda','diop','fall','gueye','faye','diouf','toure','sy','ba','lo','sarr','ndoye','thiaw','ndiaye'],
  ghana:        ['ruwaida','sumaila','abubakari','balure','bashiru','nyamah','sylvester','mensah','asante','boateng','acheampong','owusu','amoah','darko','opoku','appiah','ofori'],
  egypt:        ['dhiaa','ghasan','fathy','zohairy','ibrahim','mahmoud','sayed','mostafa','khaled','walid','amr','tamer','sherif','ashraf'],
  morocco:      ['chouini','issam','jaid','benali','benmoussa','benomar','benziane','chaoui','chraibi','elalami','elfassi'],
  'saudi arabia':['alqahtani','alharbi','abdalmajeed','alghamdi','alshehri','alahmadi','alotaibi','albalawi'],
  uae:          ['alsaiari','alghanemi','alnuaimi','almazrouei','alkaabi','almansoori','almheiri','alketbi','alshehhi'],
  nigeria:      ['adeyemi','adewale','adebayo','adesola','balogun','chukwu','emeka','okafor','okonkwo','eze','igwe','nwachukwu'],
  kenya:        ['kamau','wanjiku','mwangi','njoroge','kariuki','gitau','ndungu','mugo','kinyua'],
};

function guessNat(name) {
  if (!name) return '';
  const l     = name.toLowerCase().replace(/[^a-z\s]/g, '');
  const words = l.split(/\s+/);
  // Exact word match first
  for (const [nat, keys] of Object.entries(NAT_MAP)) {
    for (const k of keys) {
      if (k.length < 4) continue;
      if (words.some(w => w === k || (w.startsWith(k) && k.length > 5) || (k.startsWith(w) && w.length > 4))) {
        return nat.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      }
    }
  }
  // Substring match fallback
  for (const [nat, keys] of Object.entries(NAT_MAP)) {
    for (const k of keys) {
      if (k.length >= 6 && l.includes(k)) {
        return nat.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      }
    }
  }
  return '';
}
