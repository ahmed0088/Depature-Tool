// ═══════════════════════════════════════════════════════════
//  i18n.js — the app in your language, and font styles
//  Only the app's own words change (menus, page names, buttons,
//  settings). Guest names, rooms and anything typed stay exactly
//  as they are. Works offline: nothing is sent anywhere.
//  Words not in the list stay in English.
// ═══════════════════════════════════════════════════════════

const HO_LANGS = [['en', 'English', '🇬🇧'], ['ar', 'العربية', '🇦🇪'], ['fr', 'Français', '🇫🇷'], ['hi', 'हिन्दी', '🇮🇳'], ['ru', 'Русский', '🇷🇺'], ['zh', '中文', '🇨🇳'], ['tl', 'Filipino', '🇵🇭']];
const _HO_LI = { ar: 0, fr: 1, hi: 2, ru: 3, zh: 4, tl: 5 };
// English → [Arabic, French, Hindi, Russian, Chinese, Filipino]
const HO_T = {
  // menu and pages
  'Home': ['الرئيسية', 'Accueil', 'होम', 'Главная', '首页', 'Home'],
  'Departures': ['المغادرون', 'Départs', 'प्रस्थान', 'Выезды', '离店', 'Mga Aalis'],
  'Depart': ['المغادرة', 'Départs', 'प्रस्थान', 'Выезд', '离店', 'Aalis'],
  'Arrivals': ['الوافدون', 'Arrivées', 'आगमन', 'Заезды', '到店', 'Mga Darating'],
  'Arr vs Dep': ['وصول/مغادرة', 'Arr. vs Dép.', 'आगमन बनाम प्रस्थान', 'Заезд/выезд', '到店对离店', 'Dating vs Alis'],
  'Arr ↔ Dep': ['وصول ↔ مغادرة', 'Arr. ↔ Dép.', 'आगमन ↔ प्रस्थान', 'Заезд ↔ выезд', '到店 ↔ 离店', 'Dating ↔ Alis'],
  'Purpose of Stay': ['غرض الإقامة', 'Motif du séjour', 'ठहरने का उद्देश्य', 'Цель поездки', '入住目的', 'Layunin ng Pananatili'],
  'Purpose': ['الغرض', 'Motif', 'उद्देश्य', 'Цель', '目的', 'Layunin'],
  'Shift Tasks': ['مهام الوردية', 'Tâches du service', 'शिफ्ट के कार्य', 'Задачи смены', '班次任务', 'Gawain sa Shift'],
  'Roster': ['جدول المناوبات', 'Planning', 'रोस्टर', 'График', '排班表', 'Roster'],
  'Night Checklist': ['قائمة مهام الليل', 'Check-list de nuit', 'रात्रि चेकलिस्ट', 'Ночной чек-лист', '夜班清单', 'Checklist sa Gabi'],
  'Checklist': ['قائمة المهام', 'Check-list', 'चेकलिस्ट', 'Чек-лист', '清单', 'Checklist'],
  'More': ['المزيد', 'Plus', 'और', 'Ещё', '更多', 'Iba pa'],
  'Nationality': ['الجنسية', 'Nationalité', 'राष्ट्रीयता', 'Гражданство', '国籍', 'Nasyonalidad'],
  'Nationality Report': ['تقرير الجنسيات', 'Rapport des nationalités', 'राष्ट्रीयता रिपोर्ट', 'Отчёт по гражданству', '国籍报告', 'Ulat ng Nasyonalidad'],
  'Rented Rooms': ['الغرف المؤجرة', 'Chambres louées', 'किराए के कमरे', 'Сданные номера', '已租房间', 'Mga Inupahang Kuwarto'],
  'Rented Rooms & Beds': ['الغرف والأسرّة المؤجرة', 'Chambres et lits loués', 'किराए के कमरे और बेड', 'Сданные номера и места', '已租房间和床位', 'Inupahang Kuwarto at Kama'],
  'PM Rooms': ['غرف PM', 'Chambres PM', 'PM कमरे', 'Номера PM', 'PM 房间', 'Mga PM na Kuwarto'],
  'Night Audit · PM Rooms': ['التدقيق الليلي · غرف PM', 'Audit de nuit · Chambres PM', 'नाइट ऑडिट · PM कमरे', 'Ночной аудит · Номера PM', '夜审 · PM 房间', 'Night Audit · PM na Kuwarto'],
  'Immigration': ['الهجرة', 'Immigration', 'आप्रवासन', 'Миграция', '移民', 'Imigrasyon'],
  'Immigration Check': ['فحص الهجرة', 'Contrôle immigration', 'आप्रवासन जाँच', 'Миграционная проверка', '移民检查', 'Pagsusuri sa Imigrasyon'],
  'Tourism Tax': ['ضريبة السياحة', 'Taxe de séjour', 'पर्यटन कर', 'Туристический сбор', '旅游税', 'Buwis sa Turismo'],
  'TD 30-Day Audit': ['تدقيق الدرهم السياحي 30 يومًا', 'Audit TD 30 jours', 'TD 30-दिवसीय ऑडिट', 'Аудит TD за 30 дней', 'TD 30 天审计', 'TD 30-Araw na Audit'],
  'DTCM Recon': ['مطابقة DTCM', 'Rapprochement DTCM', 'DTCM मिलान', 'Сверка DTCM', 'DTCM 对账', 'DTCM Recon'],
  'Inhouse Tally': ['عدد النزلاء', 'Décompte en maison', 'इन-हाउस गिनती', 'Подсчёт проживающих', '在住统计', 'Bilang ng Nasa Hotel'],
  'Package Audit': ['تدقيق الباقات', 'Audit des forfaits', 'पैकेज ऑडिट', 'Аудит пакетов', '套餐审计', 'Audit ng Package'],
  'Arr Processor': ['معالج الوصول', 'Traitement arrivées', 'आगमन प्रोसेसर', 'Обработка заездов', '到店处理', 'Processor ng Dating'],
  'Arrivals Processor': ['معالج الوافدين', 'Traitement des arrivées', 'आगमन प्रोसेसर', 'Обработка заездов', '到店处理器', 'Processor ng Darating'],
  'No-Shows': ['عدم الحضور', 'No-shows', 'नो-शो', 'Неявки', '未到店', 'Hindi Dumating'],
  'No-Show Tracker': ['متابعة عدم الحضور', 'Suivi des no-shows', 'नो-शो ट्रैकर', 'Учёт неявок', '未到店跟踪', 'Tracker ng Hindi Dumating'],
  'Reports': ['التقارير', 'Rapports', 'रिपोर्ट', 'Отчёты', '报告', 'Mga Ulat'],
  'Trends': ['الاتجاهات', 'Tendances', 'रुझान', 'Тренды', '趋势', 'Mga Trend'],
  'Guest Pipeline': ['قائمة الضيوف', 'Pipeline clients', 'अतिथि पाइपलाइन', 'Воронка гостей', '客人管道', 'Pipeline ng Bisita'],
  'Guest Memory': ['ذاكرة الضيوف', 'Mémoire clients', 'अतिथि स्मृति', 'Память о гостях', '客人记忆', 'Alaala ng Bisita'],
  'Accor Standards': ['معايير أكور', 'Standards Accor', 'Accor मानक', 'Стандарты Accor', '雅高标准', 'Pamantayan ng Accor'],
  'History': ['السجل', 'Historique', 'इतिहास', 'История', '历史', 'Kasaysayan'],
  'Settings': ['الإعدادات', 'Réglages', 'सेटिंग्स', 'Настройки', '设置', 'Mga Setting'],
  'Learn HotelOps': ['تعلّم HotelOps', 'Apprendre HotelOps', 'HotelOps सीखें', 'Обучение HotelOps', '学习 HotelOps', 'Matuto ng HotelOps'],
  'Wake-ups': ['الإيقاظ', 'Réveils', 'वेक-अप', 'Побудки', '叫醒', 'Wake-up'],
  'Wake-up Calls': ['مكالمات الإيقاظ', 'Appels réveil', 'वेक-अप कॉल', 'Звонки-побудки', '叫醒电话', 'Mga Wake-up Call'],
  'Wake-up calls': ['مكالمات الإيقاظ', 'Appels réveil', 'वेक-अप कॉल', 'Звонки-побудки', '叫醒电话', 'Mga Wake-up Call'],
  'Rate Shop': ['مقارنة الأسعار', 'Veille tarifaire', 'रेट तुलना', 'Сравнение цен', '比价', 'Paghambing ng Presyo'],
  'Operations': ['العمليات', 'Opérations', 'संचालन', 'Операции', '运营', 'Operasyon'],
  'Tools': ['الأدوات', 'Outils', 'उपकरण', 'Инструменты', '工具', 'Mga Kasangkapan'],
  'System': ['النظام', 'Système', 'सिस्टम', 'Система', '系统', 'Sistema'],
  'All Features': ['كل الميزات', 'Toutes les fonctions', 'सभी सुविधाएँ', 'Все функции', '全部功能', 'Lahat ng Feature'],
  // home
  'Roster builder': ['منشئ الجدول', 'Création du planning', 'रोस्टर बिल्डर', 'Составление графика', '排班生成', 'Gumawa ng Roster'],
  'My next shift': ['مناوبتي القادمة', 'Mon prochain service', 'मेरी अगली शिफ्ट', 'Моя следующая смена', '我的下一班', 'Susunod kong Shift'],
  'Rates vs market': ['أسعارنا مقابل السوق', 'Prix vs marché', 'दरें बनाम बाज़ार', 'Цены и рынок', '价格对比市场', 'Presyo vs Merkado'],
  'ALL enrollment': ['تسجيل ALL', 'Adhésions ALL', 'ALL नामांकन', 'Регистрация в ALL', 'ALL 会员注册', 'Pag-enroll sa ALL'],
  'Ops Brain suggests': ['اقتراحات Ops Brain', 'Ops Brain suggère', 'Ops Brain का सुझाव', 'Ops Brain советует', 'Ops Brain 建议', 'Mungkahi ng Ops Brain'],
  'New to HotelOps?': ['جديد على HotelOps؟', 'Nouveau sur HotelOps ?', 'HotelOps में नए हैं?', 'Впервые в HotelOps?', '刚开始用 HotelOps？', 'Bago sa HotelOps?'],
  'Not run yet': ['لم يُشغّل بعد', 'Pas encore lancé', 'अभी नहीं चलाया', 'Ещё не запускали', '尚未运行', 'Hindi pa napapatakbo'],
  "Load today's Opera departures": ['حمّل مغادري اليوم من Opera', 'Chargez les départs Opera du jour', 'आज के Opera प्रस्थान लोड करें', 'Загрузите выезды из Opera', '载入今天的 Opera 离店', 'I-load ang mga aalis ngayon mula sa Opera'],
  "Load today's Opera arrivals": ['حمّل وافدي اليوم من Opera', 'Chargez les arrivées Opera du jour', 'आज के Opera आगमन लोड करें', 'Загрузите заезды из Opera', '载入今天的 Opera 到店', 'I-load ang mga darating ngayon mula sa Opera'],
  'Sync from Arrivals to start': ['زامن من الوافدين للبدء', 'Synchronisez depuis Arrivées', 'शुरू करने के लिए आगमन से सिंक करें', 'Синхронизируйте из заездов', '从到店同步开始', 'I-sync mula sa Darating para magsimula'],
  'invitations sent this month': ['دعوات أُرسلت هذا الشهر', 'invitations envoyées ce mois-ci', 'इस महीने भेजे गए निमंत्रण', 'приглашений в этом месяце', '本月已发邀请', 'imbitasyong naipadala ngayong buwan'],
  'next week posted': ['جدول الأسبوع القادم منشور', 'semaine prochaine publiée', 'अगला सप्ताह पोस्ट हुआ', 'следующая неделя опубликована', '下周已发布', 'naipost na ang susunod na linggo'],
  'Night Shift': ['الوردية الليلية', 'Service de nuit', 'रात्रि शिफ्ट', 'Ночная смена', '夜班', 'Shift sa Gabi'],
  'Morning Shift': ['الوردية الصباحية', 'Service du matin', 'सुबह की शिफ्ट', 'Утренняя смена', '早班', 'Shift sa Umaga'],
  'Afternoon Shift': ['الوردية المسائية', "Service de l'après-midi", 'दोपहर की शिफ्ट', 'Дневная смена', '中班', 'Shift sa Hapon'],
  'Add the team roster once a week': ['أضف جدول الفريق مرة في الأسبوع', "Ajoutez le planning de l'équipe une fois par semaine", 'हर सप्ताह एक बार टीम का रोस्टर जोड़ें', 'Добавляйте график команды раз в неделю', '每周添加一次团队排班', 'Idagdag ang roster ng team minsan sa isang linggo'],
  'Learn the app in short lessons, with "Show me" for every page': ['تعلّم التطبيق بدروس قصيرة، مع "أرني" لكل صفحة', 'Apprenez l’app en courtes leçons, avec « Montre-moi » sur chaque page', 'छोटे पाठों में ऐप सीखें, हर पेज पर "दिखाओ" के साथ', 'Изучите приложение короткими уроками с кнопкой «Покажи» на каждой странице', '通过简短课程学习应用，每页都有“演示”', 'Matutunan ang app sa maiikling aralin, may "Ipakita" sa bawat pahina'],
  'Tap a tile to open the page. Numbers update as you and your colleagues work.': ['اضغط على مربع لفتح الصفحة. تتحدث الأرقام أثناء عملك وعمل زملائك.', 'Touchez une tuile pour ouvrir la page. Les chiffres se mettent à jour pendant que vous et vos collègues travaillez.', 'पेज खोलने के लिए टाइल पर टैप करें। आप और आपके साथी काम करते हैं तो संख्याएँ अपडेट होती हैं।', 'Нажмите на плитку, чтобы открыть страницу. Цифры обновляются, пока вы и коллеги работаете.', '点按卡片打开页面。数字会随着你和同事的工作实时更新。', 'I-tap ang tile para buksan ang pahina. Nag-a-update ang mga numero habang nagtatrabaho kayo.'],
  'Standards & help': ['المعايير والمساعدة', 'Standards et aide', 'मानक और मदद', 'Стандарты и помощь', '标准与帮助', 'Pamantayan at Tulong'],
  // roster
  'Add roster': ['أضف الجدول', 'Ajouter le planning', 'रोस्टर जोड़ें', 'Добавить график', '添加排班', 'Magdagdag ng Roster'],
  'Build roster': ['أنشئ الجدول', 'Créer le planning', 'रोस्टर बनाएँ', 'Составить график', '生成排班', 'Gumawa ng Roster'],
  'Sick / leave': ['مرض / إجازة', 'Maladie / congé', 'बीमार / छुट्टी', 'Болезнь / отпуск', '病假 / 休假', 'Maysakit / Leave'],
  'Swap shifts': ['تبديل المناوبات', 'Échanger des services', 'शिफ्ट बदलें', 'Обмен сменами', '换班', 'Magpalit ng Shift'],
  'Change this week': ['عدّل هذا الأسبوع', 'Modifier cette semaine', 'इस सप्ताह बदलें', 'Изменить эту неделю', '修改本周', 'Baguhin ang linggong ito'],
  'My shifts': ['مناوباتي', 'Mes services', 'मेरी शिफ्ट', 'Мои смены', '我的班次', 'Mga Shift Ko'],
  'This week': ['هذا الأسبوع', 'Cette semaine', 'यह सप्ताह', 'Эта неделя', '本周', 'Ngayong Linggo'],
  'Live desk': ['المكتب المباشر', 'Comptoir en direct', 'लाइव डेस्क', 'Стойка онлайн', '实时前台', 'Live na Desk'],
  'Morning': ['صباحي', 'Matin', 'सुबह', 'Утро', '早班', 'Umaga'],
  'Afternoon': ['مسائي', 'Après-midi', 'दोपहर', 'День', '中班', 'Hapon'],
  'Night': ['ليلي', 'Nuit', 'रात', 'Ночь', '夜班', 'Gabi'],
  'Off': ['عطلة', 'Repos', 'छुट्टी', 'Выходной', '休息', 'Day off'],
  'Leave': ['إجازة', 'Congé', 'अवकाश', 'Отпуск', '休假', 'Leave'],
  'Other': ['أخرى', 'Autre', 'अन्य', 'Другое', '其他', 'Iba pa'],
  // common buttons
  'Save': ['حفظ', 'Enregistrer', 'सहेजें', 'Сохранить', '保存', 'I-save'],
  'Cancel': ['إلغاء', 'Annuler', 'रद्द करें', 'Отмена', '取消', 'Kanselahin'],
  'Clear': ['مسح', 'Effacer', 'साफ़ करें', 'Очистить', '清除', 'Burahin'],
  'Copy': ['نسخ', 'Copier', 'कॉपी', 'Копировать', '复制', 'Kopyahin'],
  'Close': ['إغلاق', 'Fermer', 'बंद करें', 'Закрыть', '关闭', 'Isara'],
  'Delete': ['حذف', 'Supprimer', 'हटाएँ', 'Удалить', '删除', 'Burahin'],
  'Edit': ['تعديل', 'Modifier', 'संपादित करें', 'Изменить', '编辑', 'I-edit'],
  'Add': ['إضافة', 'Ajouter', 'जोड़ें', 'Добавить', '添加', 'Idagdag'],
  'Refresh': ['تحديث', 'Actualiser', 'रीफ़्रेश', 'Обновить', '刷新', 'I-refresh'],
  'Load Report': ['حمّل التقرير', 'Charger le rapport', 'रिपोर्ट लोड करें', 'Загрузить отчёт', '载入报告', 'I-load ang Ulat'],
  'Copy Log': ['انسخ السجل', 'Copier le journal', 'लॉग कॉपी करें', 'Копировать журнал', '复制日志', 'Kopyahin ang Log'],
  'Skip': ['تخطٍّ', 'Passer', 'छोड़ें', 'Пропустить', '跳过', 'Laktawan'],
  'Done': ['تم', 'Terminé', 'हो गया', 'Готово', '完成', 'Tapos'],
  'Today': ['اليوم', "Aujourd'hui", 'आज', 'Сегодня', '今天', 'Ngayon'],
  'Tomorrow': ['غدًا', 'Demain', 'कल', 'Завтра', '明天', 'Bukas'],
  'Yesterday': ['أمس', 'Hier', 'कल (बीता)', 'Вчера', '昨天', 'Kahapon'],
  'Now': ['الآن', 'Maintenant', 'अभी', 'Сейчас', '现在', 'Ngayon'],
  'Upload': ['رفع', 'Importer', 'अपलोड', 'Загрузить', '上传', 'I-upload'],
  'How to use this': ['طريقة الاستخدام', 'Mode d’emploi', 'इसका उपयोग कैसे करें', 'Как пользоваться', '使用方法', 'Paano gamitin'],
  'Handover Notes': ['ملاحظات التسليم', 'Notes de relève', 'हैंडओवर नोट्स', 'Заметки для смены', '交接备注', 'Mga Tala sa Handover'],
  'Activity Log': ['سجل النشاط', "Journal d'activité", 'गतिविधि लॉग', 'Журнал действий', '活动日志', 'Log ng Aktibidad'],
  'Departure Follow-Up': ['متابعة المغادرين', 'Suivi des départs', 'प्रस्थान फ़ॉलो-अप', 'Контроль выездов', '离店跟进', 'Follow-up sa Pag-alis'],
  // sign-in
  'Email Address': ['البريد الإلكتروني', 'Adresse e-mail', 'ईमेल पता', 'Эл. почта', '电子邮箱', 'Email Address'],
  'Password': ['كلمة المرور', 'Mot de passe', 'पासवर्ड', 'Пароль', '密码', 'Password'],
  'Stay signed in': ['ابقَ مسجّلًا', 'Rester connecté', 'साइन इन रहें', 'Не выходить', '保持登录', 'Manatiling naka-sign in'],
  'Sign In': ['تسجيل الدخول', 'Se connecter', 'साइन इन', 'Войти', '登录', 'Mag-sign In'],
  'Sign in to continue': ['سجّل الدخول للمتابعة', 'Connectez-vous pour continuer', 'जारी रखने के लिए साइन इन करें', 'Войдите, чтобы продолжить', '登录以继续', 'Mag-sign in para magpatuloy'],
  'Front office operations': ['عمليات الاستقبال', 'Opérations de réception', 'फ्रंट ऑफ़िस संचालन', 'Работа ресепшена', '前台运营', 'Operasyon ng Front Office'],
  // settings
  'Appearance': ['المظهر', 'Apparence', 'रूप', 'Оформление', '外观', 'Itsura'],
  'Top bar': ['الشريط العلوي', 'Barre du haut', 'ऊपरी बार', 'Верхняя панель', '顶部栏', 'Itaas na Bar'],
  'Date & time': ['التاريخ والوقت', 'Date et heure', 'तारीख और समय', 'Дата и время', '日期和时间', 'Petsa at Oras'],
  'Menu & pages': ['القائمة والصفحات', 'Menu et pages', 'मेनू और पेज', 'Меню и страницы', '菜单和页面', 'Menu at mga Pahina'],
  'Helpers': ['المساعدات', 'Aides', 'सहायक', 'Подсказки', '助手', 'Mga Katulong'],
  'Alerts & sounds': ['التنبيهات والأصوات', 'Alertes et sons', 'अलर्ट और ध्वनि', 'Уведомления и звуки', '提醒和声音', 'Alerto at Tunog'],
  'Privacy & security': ['الخصوصية والأمان', 'Confidentialité et sécurité', 'गोपनीयता और सुरक्षा', 'Конфиденциальность', '隐私和安全', 'Privacy at Seguridad'],
  'Hotel': ['الفندق', 'Hôtel', 'होटल', 'Отель', '酒店', 'Hotel'],
  'Sync': ['المزامنة', 'Synchronisation', 'सिंक', 'Синхронизация', '同步', 'Sync'],
  'Data & storage': ['البيانات والتخزين', 'Données et stockage', 'डेटा और स्टोरेज', 'Данные и хранилище', '数据和存储', 'Data at Storage'],
  'Advanced': ['متقدم', 'Avancé', 'उन्नत', 'Дополнительно', '高级', 'Advanced'],
  'Account': ['الحساب', 'Compte', 'खाता', 'Аккаунт', '账户', 'Account'],
  'About': ['حول', 'À propos', 'परिचय', 'О приложении', '关于', 'Tungkol'],
  'Language': ['اللغة', 'Langue', 'भाषा', 'Язык', '语言', 'Wika'],
  'Font': ['الخط', 'Police', 'फ़ॉन्ट', 'Шрифт', '字体', 'Font'],
  'Text size': ['حجم النص', 'Taille du texte', 'टेक्स्ट का आकार', 'Размер текста', '文字大小', 'Laki ng Teksto'],
  'Theme': ['السمة', 'Thème', 'थीम', 'Тема', '主题', 'Tema'],
};
// sentences with a name or number inside
const HO_TP = [
  [/^Good morning, (.+)$/, ['صباح الخير، $1', 'Bonjour, $1', 'सुप्रभात, $1', 'Доброе утро, $1', '早上好，$1', 'Magandang umaga, $1']],
  [/^Good afternoon, (.+)$/, ['مساء الخير، $1', 'Bon après-midi, $1', 'शुभ दोपहर, $1', 'Добрый день, $1', '下午好，$1', 'Magandang hapon, $1']],
  [/^Good evening, (.+)$/, ['مساء الخير، $1', 'Bonsoir, $1', 'शुभ संध्या, $1', 'Добрый вечер, $1', '晚上好，$1', 'Magandang gabi, $1']],
  [/^Good night, (.+)$/, ['تصبح على خير، $1', 'Bonne nuit, $1', 'शुभ रात्रि, $1', 'Доброй ночи, $1', '晚安，$1', 'Magandang gabi, $1']],
  [/^(\d+) of (\d+) steps$/, ['$1 من $2 خطوة', '$1 sur $2 étapes', '$2 में से $1 चरण', '$1 из $2 шагов', '$2 步中的 $1 步', '$1 sa $2 hakbang']],
];

function hoLang() { return (typeof hoPrefs !== 'undefined' && hoPrefs.lang) || 'en'; }
function hoT(en, lang) {
  lang = lang || hoLang(); const i = _HO_LI[lang]; if (i == null) return en;
  const row = HO_T[en]; if (row) return row[i] || en;
  for (const [re, tr] of HO_TP) { const m = en.match(re); if (m) return en.replace(re, tr[i]); }
  return null;
}
const _HO_SKIP = /^(SCRIPT|STYLE|TEXTAREA|INPUT|SELECT|OPTION|CODE|PRE|NOSCRIPT)$/;
let _hoTrBusy = false;
// never translated: the HotelOps name, hotel names, people's name tags
const _HO_NOTR = '[contenteditable],.no-tr,.ho-name,.login-title,.logo-name,#hotelName,.ho-brand,.ho-hero h1,.lv-tag,.lv-sign';
/** Change one text node to the language (and back), keeping its spaces. */
function _hoTrNode(n, lang) {
  if (n._hoTr !== undefined && n.data !== n._hoTr) { n._hoEn = undefined; n._hoTr = undefined; }   // the app wrote new text: that is the English now
  const en = n._hoEn !== undefined ? n._hoEn : n.data, core = en.trim(); if (!core || core.length > 160) return;
  if (lang === 'en') { if (n._hoEn !== undefined) { n.data = n._hoEn; n._hoEn = n._hoTr = undefined; } return; }
  const t = hoT(core, lang); if (!t) return;
  const out = en.replace(core, t); if (n.data !== out) n.data = out;
  n._hoEn = en; n._hoTr = out;
}
function _hoTrTree(root, lang) {
  if (!root) return;
  if (root.nodeType === 3) { const p = root.parentElement; if (p && !_HO_SKIP.test(p.tagName) && !p.closest(_HO_NOTR)) _hoTrNode(root, lang); return; }
  if (root.nodeType !== 1 || _HO_SKIP.test(root.tagName) || root.closest(_HO_NOTR)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: x => { const p = x.parentElement; return !p || _HO_SKIP.test(p.tagName) || p.closest(_HO_NOTR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } });
  let n; while ((n = w.nextNode())) _hoTrNode(n, lang);
  root.querySelectorAll('[placeholder]').forEach(e => { const en = e.dataset.hoPh || e.placeholder, t = lang === 'en' ? null : hoT(en.trim(), lang); if (t) { e.dataset.hoPh = en; e.placeholder = t; } else if (e.dataset.hoPh) { e.placeholder = e.dataset.hoPh; delete e.dataset.hoPh; } });
}
let _hoTrObs = null, _hoTrQ = new Set(), _hoTrRaf = 0;
/** The whole app in the chosen language, and everything drawn later too. */
function hoI18nApply() {
  const lang = hoLang(), html = document.documentElement;
  html.lang = lang === 'zh' ? 'zh-Hans' : lang; html.classList.toggle('ho-lang-ar', lang === 'ar');
  _hoTrBusy = true; try { _hoTrTree(document.body, lang); } finally { _hoTrBusy = false; }
  if (lang === 'en') { if (_hoTrObs) { _hoTrObs.disconnect(); _hoTrObs = null; } return; }
  if (_hoTrObs) return;
  _hoTrObs = new MutationObserver(ms => {
    if (_hoTrBusy) return;
    ms.forEach(m => { if (m.type === 'characterData') _hoTrQ.add(m.target); else m.addedNodes.forEach(x => _hoTrQ.add(x)); });
    if (!_hoTrRaf) _hoTrRaf = requestAnimationFrame(() => { _hoTrRaf = 0; const L = hoLang(), q = [..._hoTrQ]; _hoTrQ.clear(); _hoTrBusy = true; try { q.forEach(x => x.isConnected && _hoTrTree(x, L)); } finally { _hoTrBusy = false; } });
  });
  _hoTrObs.observe(document.body, { childList: true, subtree: true, characterData: true });
}

// ── Font styles ─────────────────────────────────────────────
// [label, CSS family, Google Fonts family (null = already loaded / on the device), what it is like]
const HO_FONTS = {
  inter: ['Inter', "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", null, 'Clean (default)'],
  system: ['System', "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", null, 'Your device\'s own'],
  dmsans: ['DM Sans', "'DM Sans', sans-serif", null, 'Soft and modern'],
  poppins: ['Poppins', "'Poppins', sans-serif", 'Poppins:wght@400;500;600;700;800', 'Round and friendly'],
  nunito: ['Nunito', "'Nunito', sans-serif", 'Nunito:wght@400;600;700;800', 'Rounded, playful'],
  montserrat: ['Montserrat', "'Montserrat', sans-serif", 'Montserrat:wght@400;500;600;700;800', 'Bold, hotel-sign style'],
  roboto: ['Roboto', "'Roboto', sans-serif", 'Roboto:wght@400;500;700;900', 'Android classic'],
  lato: ['Lato', "'Lato', sans-serif", 'Lato:wght@400;700;900', 'Warm and calm'],
  lexend: ['Lexend', "'Lexend', sans-serif", 'Lexend:wght@400;500;600;700;800', 'Easiest to read fast'],
  atkinson: ['Atkinson', "'Atkinson Hyperlegible', sans-serif", 'Atkinson+Hyperlegible:wght@400;700', 'Made for clear reading'],
  cairo: ['Cairo', "'Cairo', sans-serif", 'Cairo:wght@400;500;600;700;800', 'Arabic and English'],
  serif: ['Playfair', "'Playfair Display', Georgia, serif", 'Playfair+Display:wght@400;600;700;800', 'Elegant, luxury'],
};
function _hoFontLink(id, href) { let l = document.getElementById(id); if (!l) { l = document.createElement('link'); l.id = id; l.rel = 'stylesheet'; document.head.appendChild(l); } if (l.href !== href) l.href = href; }
function hoApplyFont() {
  const R = document.documentElement.style, F = HO_FONTS[(typeof hoPrefs !== 'undefined' && hoPrefs.font) || 'inter'] || HO_FONTS.inter;
  if (F[2]) _hoFontLink('hoFontLink', `https://fonts.googleapis.com/css2?family=${F[2]}&display=swap`);
  if ((hoPrefs.font || 'inter') === 'inter') R.removeProperty('--font'); else R.setProperty('--font', F[1], 'important');
}
/** Small preview files (only the letters shown) so every choice shows in its own font. */
function hoFontPreviews() {
  const fam = Object.values(HO_FONTS).filter(f => f[2]).map(f => 'family=' + f[2].split(':')[0]).join('&');
  _hoFontLink('hoFontPrev', `https://fonts.googleapis.com/css2?${fam}&text=${encodeURIComponent('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 (),\'')}&display=swap`);
}
/** The two Settings rows: language and font. */
function hoLangFontHtml() {
  const lang = hoLang(), font = hoPrefs.font || 'inter';
  return `<div class="hs-row hs-col" data-s="language translate arabic french hindi russian chinese filipino">
      <span class="hs-txt"><b>Language</b><small>Menus, page names and buttons. Guest names and data stay as they are</small></span>
      <div class="ho-langs">${HO_LANGS.map(([k, n, f]) => `<button class="${lang === k ? 'on' : ''}" onclick="hoSetPref('lang','${k}');hoSettingsRender()"><span>${f}</span>${n}</button>`).join('')}</div>
    </div>
    <div class="hs-row hs-col" data-s="font typeface style letters">
      <span class="hs-txt"><b>Font</b><small>The letters used everywhere in the app, on this device</small></span>
      <div class="ho-fonts">${Object.entries(HO_FONTS).map(([k, f]) => `<button class="${font === k ? 'on' : ''}" onclick="hoSetPref('font','${k}');hoSettingsRender()" style="font-family:${f[1].replace(/"/g, '&quot;')}"><b>Aa</b><span>${f[0]}</span><small>${f[3]}</small></button>`).join('')}</div>
    </div>`;
}
