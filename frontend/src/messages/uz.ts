/**
 * All user-facing strings, Uzbek only for now (task: "Text in Uzbek (uz) for
 * now, all strings in one messages file so ru/en can be added later"). Not a
 * full i18n library — a flat object is enough for one locale; if ru/en are
 * added later this is the point where a real i18n lib would replace it.
 */
export const uz = {
  home: {
    title: 'REAL MAFIA',
    createRoom: 'Xona yaratish',
    creating: 'Yaratilmoqda…',
    joinByCode: 'Kod bilan qo‘shilish',
    codePlaceholder: 'Xona kodi',
    joining: 'Qo‘shilinmoqda…',
    debugLink: 'Debug ekran',
  },
  lobby: {
    title: 'Kutish xonasi',
    codeLabel: 'Xona kodi',
    copyCode: 'Nusxalash',
    copied: 'Nusxalandi!',
    shareLink: 'Havolani ulashish',
    players: (count: number, max: number) => `${count} / ${max} o‘yinchi`,
    you: 'Siz',
    host: 'xona egasi',
    ready: 'Tayyor',
    notReady: 'Tayyor emas',
    readyButton: 'Tayyorman',
    notReadyButton: 'Tayyor emasman',
    leaveButton: 'Xonadan chiqish',
    leaving: 'Chiqilmoqda…',
    startButton: 'O‘yinni boshlash',
    starting: 'Boshlanmoqda…',
    startReasonNotHost: 'Faqat xona egasi o‘yinni boshlashi mumkin',
    startReasonNotEnoughPlayers: (min: number, current: number) =>
      `Kamida ${min} o‘yinchi kerak (hozir: ${current})`,
    startReasonNotInLobby: 'Xona hozir lobbi holatida emas',
    disconnectedBanner: 'Aloqa uzildi — qayta ulanmoqda…',
    reconnectedRefreshing: 'Qayta ulandi — holat yangilanmoqda…',
    loadingRoster: 'Ro‘yxat yuklanmoqda…',
    removedNotice: 'Siz bu xonada emassiz — ehtimol chiqarilgansiz yoki xona yopilgan.',
  },
  started: {
    title: 'O‘yin boshlandi',
    phase: (phase: string) => `Bosqich: ${phase}`,
    note: 'O‘yin ekranlari keyingi bosqichda qo‘shiladi.',
    backHome: 'Bosh sahifaga qaytish',
  },
  phases: {
    LOBBY: 'Kutish xonasi',
    ROLE_REVEAL: 'Rollar e’lon qilinmoqda',
    NIGHT: 'Tun',
    NIGHT_RESOLUTION: 'Tun natijalari',
    MORNING: 'Ertalab',
    DISCUSSION: 'Muhokama',
    VOTING: 'Ovoz berish',
    VOTE_RESOLUTION: 'Ovoz natijalari',
    LAST_WORD: 'So‘nggi so‘z',
    EXECUTION: 'Jazolash',
    WIN_CHECK: 'G‘alaba tekshirilmoqda',
    GAME_OVER: 'O‘yin tugadi',
    unknown: 'Noma’lum bosqich',
  },
  teams: {
    TOWN: 'Tinch aholi',
    MAFIA: 'Mafiya',
    NEUTRAL: 'Mustaqil',
  },
  roles: {
    MAFIA: {
      name: 'Mafiya',
      ability: 'Har kecha boshqa mafiyachilar bilan birga qurbon tanlab, uni o‘ldirasiz.',
    },
    DON: {
      name: 'Don',
      ability: 'Tungi o‘ldirishni boshqarasiz va kechasi birovning sherif ekanini tekshirishingiz mumkin.',
    },
    DETECTIVE: {
      name: 'Detektiv',
      ability: 'Har kecha bir o‘yinchini tekshirib, u mafiya ekanini aniqlaysiz.',
    },
    SHERIFF: {
      name: 'Sherif',
      ability: 'O‘yin davomida bir marta birovni otib o‘ldirishingiz mumkin.',
    },
    DOCTOR: {
      name: 'Doktor',
      ability: 'Har kecha bir o‘yinchini davolab, uni o‘limdan saqlaysiz.',
    },
    BODYGUARD: {
      name: 'Qo‘riqchi',
      ability: 'Har kecha bir o‘yinchini qo‘riqlaysiz — unga hujum qilinsa, o‘rniga siz halok bo‘lasiz.',
    },
    MANIAC: {
      name: 'Maniac',
      ability: 'Har kecha mustaqil ravishda birovni o‘ldirasiz — yolg‘iz qolib qolsangiz g‘alaba qozonasiz.',
    },
    JOURNALIST: {
      name: 'Jurnalist',
      ability: 'Har kecha ikki o‘yinchini tekshirib, ular bir xil tomonda ekanini bilib olasiz.',
    },
    CIVILIAN: {
      name: 'Tinch aholi',
      ability: 'Maxsus tungi qobiliyatingiz yo‘q — kunduzi ovoz berib mafiyani toping.',
    },
    unknown: {
      name: 'Noma’lum rol',
      ability: 'Bu rol haqida ma’lumot topilmadi.',
    },
  },
  roleReveal: {
    title: 'Sizning rolingiz',
    teammatesLabel: 'Mafiya a’zolari:',
    dismiss: 'Tushunarli',
    roleChip: (roleName: string) => `Rol: ${roleName}`,
  },
  gameScreen: {
    round: (round: number) => `${round}-tur`,
    noDeadline: '—',
    stateError: 'O‘yin holatini yuklashda xatolik',
  },
  errors: {
    ROOM_NOT_FOUND: 'Xona topilmadi',
    HOST_ALREADY_HOSTING: 'Siz allaqachon boshqa xonani boshqaryapsiz',
    GAME_NOT_JOINABLE: 'Bu xonaga hozir qo‘shilib bo‘lmaydi',
    GAME_FULL: 'Xona to‘lgan',
    PLAYER_ALREADY_JOINED: 'Siz bu xonaga allaqachon qo‘shilgansiz',
    ROOM_NOT_IN_LOBBY: 'Bu amal endi lobbi bosqichida emas',
    PLAYER_NOT_IN_GAME: 'Siz bu o‘yinda emassiz',
    NOT_HOST: 'Faqat xona egasi bu amalni bajara oladi',
    TARGET_NOT_IN_GAME: 'Belgilangan o‘yinchi bu o‘yinda emas',
    NOT_ENOUGH_PLAYERS: 'O‘yinni boshlash uchun o‘yinchilar yetarli emas',
    CONFIG_INVALID: 'Konfiguratsiya xatosi',
    generic: 'Xatolik yuz berdi. Qaytadan urinib ko‘ring.',
    network: 'Tarmoq xatosi. Ulanishni tekshirib, qaytadan urinib ko‘ring.',
  },
  auth: {
    notInTelegram: 'Bu ilova faqat Telegram ichida ishlaydi — botdan oching.',
    sessionExpired: 'Sessiya muddati tugagan. Mini App’ni yopib, botdan qayta oching.',
    retry: 'Qayta urinish',
    authenticating: 'Kirilmoqda…',
  },
} as const;
