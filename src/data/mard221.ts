import type { MardColor } from "../types";

/**
 * MARD 221 Color Palette for 拼豆 (Perler Beads)
 *
 * Color codes: M001 - M221
 * NOTE: Many hex values are placeholders derived from common perler bead palettes.
 * Update with actual MARD color card values when available.
 */
export const MARD_COLORS: MardColor[] = [
  // === 白色系 / Whites ===
  { code: "M001", name: "白色", hex: "#F7F7F2", rgb: [247, 247, 242] },
  { code: "M002", name: "奶白色", hex: "#F5F0E1", rgb: [245, 240, 225] },
  { code: "M003", name: "象牙白", hex: "#EDEDca", rgb: [237, 237, 202] },
  { code: "M004", name: "米色", hex: "#FCECCE", rgb: [252, 236, 206] },
  { code: "M005", name: "珍珠白", hex: "#F0EDE5", rgb: [240, 237, 229] },

  // === 灰色系 / Greys ===
  { code: "M006", name: "浅灰色", hex: "#BEC3BF", rgb: [190, 195, 191] },
  { code: "M007", name: "灰色", hex: "#969896", rgb: [150, 152, 150] },
  { code: "M008", name: "锡灰色", hex: "#93A19F", rgb: [147, 161, 159] },
  { code: "M009", name: "炭灰色", hex: "#545F5F", rgb: [84, 95, 95] },
  { code: "M010", name: "深灰色", hex: "#565758", rgb: [86, 87, 88] },
  { code: "M011", name: "黑色", hex: "#343234", rgb: [52, 50, 52] },
  { code: "M012", name: "石灰色", hex: "#A29898", rgb: [162, 152, 152] },

  // === 棕色系 / Browns ===
  { code: "M013", name: "烤棉花糖", hex: "#F1E5D8", rgb: [241, 229, 216] },
  { code: "M014", name: "沙色", hex: "#EAC49F", rgb: [234, 196, 159] },
  { code: "M015", name: "鹿色", hex: "#D7B087", rgb: [215, 176, 135] },
  { code: "M016", name: "棕褐色", hex: "#CFA889", rgb: [207, 168, 137] },
  { code: "M017", name: "铁锈色", hex: "#A04E3F", rgb: [160, 78, 63] },
  { code: "M018", name: "蔓越莓", hex: "#88403F", rgb: [136, 64, 63] },
  { code: "M019", name: "浅棕色", hex: "#A47B47", rgb: [164, 123, 71] },
  { code: "M020", name: "姜饼色", hex: "#7E5446", rgb: [126, 84, 70] },
  { code: "M021", name: "棕色", hex: "#6C5249", rgb: [108, 82, 73] },
  { code: "M022", name: "可可色", hex: "#504544", rgb: [80, 69, 68] },
  { code: "M023", name: "深棕色", hex: "#4A3728", rgb: [74, 55, 40] },
  { code: "M024", name: "咖啡色", hex: "#5C3D2E", rgb: [92, 61, 46] },

  // === 黄色系 / Yellows ===
  { code: "M025", name: "奶油色", hex: "#EDDEB7", rgb: [237, 222, 183] },
  { code: "M026", name: "淡黄色", hex: "#FAEE8D", rgb: [250, 238, 141] },
  { code: "M027", name: "柠檬黄", hex: "#F9EB37", rgb: [249, 235, 55] },
  { code: "M028", name: "黄色", hex: "#F9D737", rgb: [249, 215, 55] },
  { code: "M029", name: "切达黄", hex: "#FFB64E", rgb: [255, 182, 78] },
  { code: "M030", name: "金黄色", hex: "#E8A430", rgb: [232, 164, 48] },
  { code: "M031", name: "蜂蜜色", hex: "#DA8C2C", rgb: [218, 140, 44] },
  { code: "M032", name: "芥末黄", hex: "#C8A83C", rgb: [200, 168, 60] },
  { code: "M033", name: "鹅黄色", hex: "#FDF4A8", rgb: [253, 244, 168] },

  // === 橙色系 / Oranges ===
  { code: "M034", name: "橙色", hex: "#FF803E", rgb: [255, 128, 62] },
  { code: "M035", name: "奶油橙", hex: "#FFB591", rgb: [255, 181, 145] },
  { code: "M036", name: "蝴蝶酥", hex: "#E19A52", rgb: [225, 154, 82] },
  { code: "M037", name: "蜜桃色", hex: "#FCA96E", rgb: [252, 169, 110] },
  { code: "M038", name: "橘红色", hex: "#FD6C24", rgb: [253, 108, 36] },
  { code: "M039", name: "南瓜色", hex: "#E86828", rgb: [232, 104, 40] },
  { code: "M040", name: "杏色", hex: "#FCC688", rgb: [252, 198, 136] },
  { code: "M041", name: "柑橘色", hex: "#FF8840", rgb: [255, 136, 64] },

  // === 红色系 / Reds ===
  { code: "M042", name: "珊瑚红", hex: "#FF6161", rgb: [255, 97, 97] },
  { code: "M043", name: "三文鱼色", hex: "#FF7777", rgb: [255, 119, 119] },
  { code: "M044", name: "胭脂色", hex: "#FFB18D", rgb: [255, 177, 141] },
  { code: "M045", name: "火烈鸟色", hex: "#FFB5BE", rgb: [255, 181, 190] },
  { code: "M046", name: "桃色", hex: "#FCC6B8", rgb: [252, 198, 184] },
  { code: "M047", name: "红色", hex: "#C43A3A", rgb: [196, 58, 58] },
  { code: "M048", name: "深红色", hex: "#AD3333", rgb: [173, 51, 51] },
  { code: "M049", name: "樱桃红", hex: "#B03345", rgb: [176, 51, 69] },
  { code: "M050", name: "果汁红", hex: "#DA3048", rgb: [218, 48, 72] },
  { code: "M051", name: "宝石红", hex: "#A02030", rgb: [160, 32, 48] },
  { code: "M052", name: "番茄红", hex: "#EA4242", rgb: [234, 66, 66] },
  { code: "M053", name: "绯红色", hex: "#CC2233", rgb: [204, 34, 51] },

  // === 粉色系 / Pinks ===
  { code: "M054", name: "浅粉色", hex: "#F5C0C1", rgb: [245, 192, 193] },
  { code: "M055", name: "泡泡糖粉", hex: "#E16DA5", rgb: [225, 109, 165] },
  { code: "M056", name: "粉色", hex: "#E65787", rgb: [230, 87, 135] },
  { code: "M057", name: "玫红色", hex: "#F34390", rgb: [243, 67, 144] },
  { code: "M058", name: "浅玫瑰", hex: "#F0A0A8", rgb: [240, 160, 168] },
  { code: "M059", name: "樱花粉", hex: "#FFB7C5", rgb: [255, 183, 197] },
  { code: "M060", name: "淡粉色", hex: "#FFCCCC", rgb: [255, 204, 204] },
  { code: "M061", name: "荷花粉", hex: "#F8C0D0", rgb: [248, 192, 208] },
  { code: "M062", name: "洋红色", hex: "#E8489C", rgb: [232, 72, 156] },
  { code: "M063", name: "棉花糖粉", hex: "#F4A0C8", rgb: [244, 160, 200] },
  { code: "M064", name: "玫瑰红", hex: "#D25975", rgb: [210, 89, 117] },

  // === 紫色系 / Purples ===
  { code: "M065", name: "薰衣草", hex: "#B4A6D4", rgb: [180, 166, 212] },
  { code: "M066", name: "淡薰衣草", hex: "#C8B0D0", rgb: [200, 176, 208] },
  { code: "M067", name: "紫色", hex: "#6F5478", rgb: [111, 84, 120] },
  { code: "M068", name: "梅子色", hex: "#B25FA0", rgb: [178, 95, 160] },
  { code: "M069", name: "覆盆子紫", hex: "#AD3C6C", rgb: [173, 60, 108] },
  { code: "M070", name: "茄子紫", hex: "#6F3250", rgb: [111, 50, 80] },
  { code: "M071", name: "葡萄紫", hex: "#504678", rgb: [80, 70, 120] },
  { code: "M072", name: "紫罗兰", hex: "#7B56A0", rgb: [123, 86, 160] },
  { code: "M073", name: "丁香紫", hex: "#9C8ABB", rgb: [156, 138, 187] },
  { code: "M074", name: "暮光紫", hex: "#9D759C", rgb: [157, 117, 156] },
  { code: "M075", name: "鸢尾花紫", hex: "#4E569C", rgb: [78, 86, 156] },
  { code: "M076", name: "霜丁香", hex: "#D0C0D0", rgb: [208, 192, 208] },
  { code: "M077", name: "蓝莓奶油", hex: "#87A7E1", rgb: [135, 167, 225] },
  { code: "M078", name: "桑葚紫", hex: "#6D3B68", rgb: [109, 59, 104] },

  // === 蓝色系 / Blues ===
  { code: "M079", name: "长春花蓝", hex: "#6C88BF", rgb: [108, 136, 191] },
  { code: "M080", name: "知更鸟蛋蓝", hex: "#B4D9DF", rgb: [180, 217, 223] },
  { code: "M081", name: "淡蓝色", hex: "#63A9D6", rgb: [99, 169, 214] },
  { code: "M082", name: "浅蓝色", hex: "#278ACB", rgb: [39, 138, 203] },
  { code: "M083", name: "钴蓝色", hex: "#0066B3", rgb: [0, 102, 179] },
  { code: "M084", name: "深蓝色", hex: "#2B3078", rgb: [43, 48, 120] },
  { code: "M085", name: "午夜蓝", hex: "#162846", rgb: [22, 40, 70] },
  { code: "M086", name: "牙膏蓝", hex: "#B0E8D5", rgb: [176, 232, 213] },
  { code: "M087", name: "天空蓝", hex: "#54CDEB", rgb: [84, 205, 235] },
  { code: "M088", name: "蔚蓝色", hex: "#2EADE4", rgb: [46, 173, 228] },
  { code: "M089", name: "矢车菊蓝", hex: "#6495ED", rgb: [100, 149, 237] },
  { code: "M090", name: "宝石蓝", hex: "#1E5CA6", rgb: [30, 92, 166] },
  { code: "M091", name: "牛仔蓝", hex: "#4E7391", rgb: [78, 115, 145] },
  { code: "M092", name: "石板蓝", hex: "#728599", rgb: [114, 133, 153] },
  { code: "M093", name: "冰蓝色", hex: "#C4E0F0", rgb: [196, 224, 240] },
  { code: "M094", name: "雾蓝色", hex: "#9CB8C8", rgb: [156, 184, 200] },

  // === 绿色系 / Greens ===
  { code: "M095", name: "浅绿色", hex: "#38C78B", rgb: [56, 199, 139] },
  { code: "M096", name: "鹦鹉绿", hex: "#009650", rgb: [0, 150, 80] },
  { code: "M097", name: "淡绿色", hex: "#73D579", rgb: [115, 213, 121] },
  { code: "M098", name: "猕猴桃绿", hex: "#77CA49", rgb: [119, 202, 73] },
  { code: "M099", name: "草绿色", hex: "#54B148", rgb: [84, 177, 72] },
  { code: "M100", name: "三叶草绿", hex: "#009640", rgb: [0, 150, 64] },
  { code: "M101", name: "深绿色", hex: "#108340", rgb: [16, 131, 64] },
  { code: "M102", name: "仙人掌绿", hex: "#CBD74B", rgb: [203, 215, 75] },
  { code: "M103", name: "常青绿", hex: "#3C613C", rgb: [60, 97, 60] },
  { code: "M104", name: "蕨绿色", hex: "#7B9748", rgb: [123, 151, 72] },
  { code: "M105", name: "橄榄绿", hex: "#73753E", rgb: [115, 117, 62] },
  { code: "M106", name: "鼠尾草绿", hex: "#9BBD8D", rgb: [155, 189, 141] },
  { code: "M107", name: "薄荷绿", hex: "#B3EEB8", rgb: [179, 238, 184] },
  { code: "M108", name: "苹果绿", hex: "#A3D14A", rgb: [163, 209, 74] },
  { code: "M109", name: "森林绿", hex: "#005C3A", rgb: [0, 92, 58] },
  { code: "M110", name: "史莱姆绿", hex: "#C4CE31", rgb: [196, 206, 49] },

  // === 青色系 / Teals & Cyans ===
  { code: "M111", name: "青色", hex: "#008B8B", rgb: [0, 139, 139] },
  { code: "M112", name: "蓝绿色", hex: "#368D8D", rgb: [54, 141, 141] },
  { code: "M113", name: "绿松石色", hex: "#008DB2", rgb: [0, 141, 178] },
  { code: "M114", name: "加勒比蓝", hex: "#00B58E", rgb: [0, 181, 142] },
  { code: "M115", name: "湖蓝色", hex: "#009EB0", rgb: [0, 158, 176] },
  { code: "M116", name: "深云杉绿", hex: "#264A38", rgb: [38, 74, 56] },
  { code: "M117", name: "蓟色", hex: "#999878", rgb: [153, 152, 120] },
  { code: "M118", name: "薄雾绿", hex: "#9CB9A7", rgb: [156, 185, 167] },

  // === 肤色系 / Skin tones ===
  { code: "M119", name: "肤色-浅", hex: "#FFE4C4", rgb: [255, 228, 196] },
  { code: "M120", name: "肤色-中", hex: "#DEB887", rgb: [222, 184, 135] },
  { code: "M121", name: "肤色-深", hex: "#C4956A", rgb: [196, 149, 106] },
  { code: "M122", name: "肤色-棕", hex: "#8B6847", rgb: [139, 104, 71] },

  // === 荧光色系 / Neons ===
  { code: "M123", name: "荧光黄", hex: "#DEFF00", rgb: [222, 255, 0] },
  { code: "M124", name: "荧光橙", hex: "#FF6600", rgb: [255, 102, 0] },
  { code: "M125", name: "荧光粉", hex: "#FF00FF", rgb: [255, 0, 255] },
  { code: "M126", name: "荧光绿", hex: "#39FF14", rgb: [57, 255, 20] },
  { code: "M127", name: "荧光红", hex: "#FF073A", rgb: [255, 7, 58] },
  { code: "M128", name: "荧光紫", hex: "#BF00FF", rgb: [191, 0, 255] },

  // === 夜光色系 / Glow in Dark ===
  { code: "M129", name: "夜光绿", hex: "#C8E8A0", rgb: [200, 232, 160] },
  { code: "M130", name: "夜光蓝", hex: "#A0D8E8", rgb: [160, 216, 232] },
  { code: "M131", name: "夜光粉", hex: "#F0B8D0", rgb: [240, 184, 208] },
  { code: "M132", name: "夜光黄", hex: "#F0F0A0", rgb: [240, 240, 160] },

  // === 透明色系 / Translucent ===
  { code: "M133", name: "透明", hex: "#F0F0F0", rgb: [240, 240, 240] },
  { code: "M134", name: "透明红", hex: "#FF6666", rgb: [255, 102, 102] },
  { code: "M135", name: "透明橙", hex: "#FFA066", rgb: [255, 160, 102] },
  { code: "M136", name: "透明黄", hex: "#FFFF66", rgb: [255, 255, 102] },
  { code: "M137", name: "透明绿", hex: "#66FF66", rgb: [102, 255, 102] },
  { code: "M138", name: "透明蓝", hex: "#6666FF", rgb: [102, 102, 255] },
  { code: "M139", name: "透明紫", hex: "#CC66FF", rgb: [204, 102, 255] },
  { code: "M140", name: "透明粉", hex: "#FF66CC", rgb: [255, 102, 204] },

  // === 金属色系 / Metallics ===
  { code: "M141", name: "金色", hex: "#D4A843", rgb: [212, 168, 67] },
  { code: "M142", name: "银色", hex: "#C0C0C0", rgb: [192, 192, 192] },
  { code: "M143", name: "铜色", hex: "#B87333", rgb: [184, 115, 51] },
  { code: "M144", name: "玫瑰金", hex: "#B76E79", rgb: [183, 110, 121] },

  // === 条纹混色系 / Striped ===
  { code: "M145", name: "条纹红白", hex: "#FF8888", rgb: [255, 136, 136] },
  { code: "M146", name: "条纹蓝白", hex: "#8888FF", rgb: [136, 136, 255] },
  { code: "M147", name: "条纹黄白", hex: "#FFFF88", rgb: [255, 255, 136] },
  { code: "M148", name: "条纹绿白", hex: "#88FF88", rgb: [136, 255, 136] },
  { code: "M149", name: "条纹粉白", hex: "#FF88CC", rgb: [255, 136, 204] },
  { code: "M150", name: "条纹橙白", hex: "#FFB088", rgb: [255, 176, 136] },

  // === 扩展色 151-221 (placeholders — update with actual MARD values) ===
  { code: "M151", name: "雪青色", hex: "#B0C4DE", rgb: [176, 196, 222] },
  { code: "M152", name: "琥珀色", hex: "#FFBF00", rgb: [255, 191, 0] },
  { code: "M153", name: "赤陶色", hex: "#C04000", rgb: [192, 64, 0] },
  { code: "M154", name: "松石绿", hex: "#40E0D0", rgb: [64, 224, 208] },
  { code: "M155", name: "靛蓝色", hex: "#4B0082", rgb: [75, 0, 130] },
  { code: "M156", name: "橄榄黄", hex: "#B5B35C", rgb: [181, 179, 92] },
  { code: "M157", name: "勃艮第红", hex: "#800020", rgb: [128, 0, 32] },
  { code: "M158", name: "海军蓝", hex: "#000080", rgb: [0, 0, 128] },
  { code: "M159", name: "苔藓绿", hex: "#8A9A5B", rgb: [138, 154, 91] },
  { code: "M160", name: "杏仁色", hex: "#EFDECD", rgb: [239, 222, 205] },
  { code: "M161", name: "水鸭蓝", hex: "#367588", rgb: [54, 117, 136] },
  { code: "M162", name: "枫叶红", hex: "#C62828", rgb: [198, 40, 40] },
  { code: "M163", name: "孔雀蓝", hex: "#006B6F", rgb: [0, 107, 111] },
  { code: "M164", name: "石榴红", hex: "#CB3234", rgb: [203, 50, 52] },
  { code: "M165", name: "焦糖色", hex: "#AF6E4D", rgb: [175, 110, 77] },
  { code: "M166", name: "柠檬绿", hex: "#BFFF00", rgb: [191, 255, 0] },
  { code: "M167", name: "烟灰色", hex: "#848482", rgb: [132, 132, 130] },
  { code: "M168", name: "酒红色", hex: "#722F37", rgb: [114, 47, 55] },
  { code: "M169", name: "蜜瓜色", hex: "#E0E8A0", rgb: [224, 232, 160] },
  { code: "M170", name: "墨绿色", hex: "#013220", rgb: [1, 50, 32] },
  { code: "M171", name: "baby蓝", hex: "#89CFF0", rgb: [137, 207, 240] },
  { code: "M172", name: "baby粉", hex: "#F4C2C2", rgb: [244, 194, 194] },
  { code: "M173", name: "蓝紫色", hex: "#5A4FCF", rgb: [90, 79, 207] },
  { code: "M174", name: "灰绿色", hex: "#78866B", rgb: [120, 134, 107] },
  { code: "M175", name: "暖灰色", hex: "#A89888", rgb: [168, 152, 136] },
  { code: "M176", name: "冷灰色", hex: "#8899A6", rgb: [136, 153, 166] },
  { code: "M177", name: "蜡笔红", hex: "#E87878", rgb: [232, 120, 120] },
  { code: "M178", name: "蜡笔蓝", hex: "#7878E8", rgb: [120, 120, 232] },
  { code: "M179", name: "蜡笔绿", hex: "#78E878", rgb: [120, 232, 120] },
  { code: "M180", name: "蜡笔紫", hex: "#C878E8", rgb: [200, 120, 232] },
  { code: "M181", name: "蜡笔黄", hex: "#E8E878", rgb: [232, 232, 120] },
  { code: "M182", name: "蜡笔橙", hex: "#E8B078", rgb: [232, 176, 120] },
  { code: "M183", name: "冰淇淋粉", hex: "#FFC8D0", rgb: [255, 200, 208] },
  { code: "M184", name: "冰淇淋蓝", hex: "#C8E8F8", rgb: [200, 232, 248] },
  { code: "M185", name: "冰淇淋绿", hex: "#C8F8D0", rgb: [200, 248, 208] },
  { code: "M186", name: "冰淇淋紫", hex: "#E8C8F8", rgb: [232, 200, 248] },
  { code: "M187", name: "冰淇淋黄", hex: "#F8F0C8", rgb: [248, 240, 200] },
  { code: "M188", name: "桃粉色", hex: "#FFBBA0", rgb: [255, 187, 160] },
  { code: "M189", name: "西瓜红", hex: "#FC6C85", rgb: [252, 108, 133] },
  { code: "M190", name: "葡萄酒红", hex: "#6A2E3F", rgb: [106, 46, 63] },
  { code: "M191", name: "秋叶橙", hex: "#D86018", rgb: [216, 96, 24] },
  { code: "M192", name: "向日葵黄", hex: "#FFDA03", rgb: [255, 218, 3] },
  { code: "M193", name: "春芽绿", hex: "#A8D88C", rgb: [168, 216, 140] },
  { code: "M194", name: "海洋蓝", hex: "#0062A0", rgb: [0, 98, 160] },
  { code: "M195", name: "天际蓝", hex: "#78B8D8", rgb: [120, 184, 216] },
  { code: "M196", name: "暮色紫", hex: "#6E4B74", rgb: [110, 75, 116] },
  { code: "M197", name: "粉晶色", hex: "#F5C6D0", rgb: [245, 198, 208] },
  { code: "M198", name: "蓝宝石", hex: "#0F52BA", rgb: [15, 82, 186] },
  { code: "M199", name: "黄玉色", hex: "#FFC87C", rgb: [255, 200, 124] },
  { code: "M200", name: "翡翠绿", hex: "#50C878", rgb: [80, 200, 120] },

  // M201-M221: Extended palette — color values to be confirmed
  { code: "M201", name: "紫水晶", hex: "#9966CC", rgb: [153, 102, 204] },
  { code: "M202", name: "红玛瑙", hex: "#B22222", rgb: [178, 34, 34] },
  { code: "M203", name: "青玉色", hex: "#48A8A0", rgb: [72, 168, 160] },
  { code: "M204", name: "琉璃蓝", hex: "#2962FF", rgb: [41, 98, 255] },
  { code: "M205", name: "珊瑚粉", hex: "#F88379", rgb: [248, 131, 121] },
  { code: "M206", name: "蜜蜡黄", hex: "#E8B84C", rgb: [232, 184, 76] },
  { code: "M207", name: "丹霞红", hex: "#C44536", rgb: [196, 69, 54] },
  { code: "M208", name: "碧玉绿", hex: "#3CB371", rgb: [60, 179, 113] },
  { code: "M209", name: "冰川蓝", hex: "#71A6D2", rgb: [113, 166, 210] },
  { code: "M210", name: "玫瑰粉", hex: "#FF66B2", rgb: [255, 102, 178] },
  { code: "M211", name: "深海蓝", hex: "#003153", rgb: [0, 49, 83] },
  { code: "M212", name: "沙漠金", hex: "#C2956C", rgb: [194, 149, 108] },
  { code: "M213", name: "极光紫", hex: "#7B68EE", rgb: [123, 104, 238] },
  { code: "M214", name: "落日橙", hex: "#FF6347", rgb: [255, 99, 71] },
  { code: "M215", name: "月光银", hex: "#D8D8D8", rgb: [216, 216, 216] },
  { code: "M216", name: "竹青色", hex: "#6E9B6C", rgb: [110, 155, 108] },
  { code: "M217", name: "胡桃棕", hex: "#5B3A29", rgb: [91, 58, 41] },
  { code: "M218", name: "云雀黄", hex: "#E6D933", rgb: [230, 217, 51] },
  { code: "M219", name: "鸢尾蓝", hex: "#5D76CB", rgb: [93, 118, 203] },
  { code: "M220", name: "蔷薇粉", hex: "#E8829C", rgb: [232, 130, 156] },
  { code: "M221", name: "墨色", hex: "#1A1A2E", rgb: [26, 26, 46] },
];

/** Lookup map: code -> index in MARD_COLORS */
export const MARD_CODE_MAP = new Map<string, number>(
  MARD_COLORS.map((c, i) => [c.code, i])
);

/** Get a MardColor by its code */
export function getMardColorByCode(code: string): MardColor | undefined {
  const idx = MARD_CODE_MAP.get(code);
  return idx !== undefined ? MARD_COLORS[idx] : undefined;
}
