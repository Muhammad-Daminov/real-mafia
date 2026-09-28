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
