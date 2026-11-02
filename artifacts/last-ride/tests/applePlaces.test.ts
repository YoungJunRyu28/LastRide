import { describe, expect, it } from "vitest";
import { distinctStations, domesticPhone, isRailwayStation, stationBaseName, stationPlaces, stationsFromSearch, taxiCompaniesFrom } from "@/lib/applePlaces";

const place = (name: string, latitude: number, longitude: number) => ({
  name,
  latitude,
  longitude,
  phone: null,
  category: "MKPOICategoryPublicTransport",
  locality: "渋谷区",
  administrativeArea: "東京都",
});

describe("stationBaseName", () => {
  it("reduces Apple's station names to one name per complex", () => {
    expect(stationBaseName("渋谷駅")).toBe("渋谷");
    expect(stationBaseName("渋谷駅 (東京メトロ)")).toBe("渋谷");
    expect(stationBaseName("元町・中華街駅（みなとみらい線）")).toBe("元町・中華街");
    expect(stationBaseName("Shibuya Station")).toBe("Shibuya");
  });
});

describe("isRailwayStation", () => {
  it("drops bus stops", () => {
    expect(isRailwayStation({ name: "渋谷駅" })).toBe(true);
    expect(isRailwayStation({ name: "渋谷駅前バス停" })).toBe(false);
    expect(isRailwayStation({ name: "道玄坂上" })).toBe(false);
  });

  it("drops gondola, ropeway and cable-car stops (運河パーク駅 is YOKOHAMA AIR CABIN)", () => {
    expect(isRailwayStation({ name: "運河パーク駅" })).toBe(false);
    expect(isRailwayStation({ name: "Unga Park Station" })).toBe(false);
    expect(isRailwayStation({ name: "桜木町駅 (YOKOHAMA AIR CABIN)" })).toBe(false);
    expect(isRailwayStation({ name: "早雲山駅（箱根ロープウェイ）" })).toBe(false);
    expect(isRailwayStation({ name: "高尾山口駅（ケーブルカー）" })).toBe(false);
    expect(isRailwayStation({ name: "ゴンドラ山頂駅" })).toBe(false);
    // The real stations next to them stay.
    expect(isRailwayStation({ name: "桜木町駅" })).toBe(true);
    expect(isRailwayStation({ name: "みなとみらい駅" })).toBe(true);
    expect(isRailwayStation({ name: "馬車道駅 (みなとみらい線)" })).toBe(true);
  });

  it("drops taxi ranks and exits named after a station", () => {
    expect(isRailwayStation({ name: "渋谷駅 タクシー乗り場" })).toBe(false);
    expect(isRailwayStation({ name: "渋谷駅 ハチ公口" })).toBe(false);
    expect(isRailwayStation({ name: "渋谷駅 (東京メトロ)" })).toBe(true);
    expect(isRailwayStation({ name: "Shibuya Station" })).toBe(true);
  });
});

describe("distinctStations", () => {
  it("discards an invalid MapKit coordinate rather than computing NaN distance", () => {
    const origin = { latitude: 35.6595, longitude: 139.7005 };
    const stations = distinctStations(origin, [
      place('東京都外駅', Infinity, 139.7),
      place('渋谷駅', 35.658, 139.701),
    ], 3);
    expect(stations).toHaveLength(1);
    expect(stations[0].station.nameJa).toBe('渋谷');
  });

  it("keeps geographically distant namesakes instead of collapsing their routes", () => {
    const origin = { latitude: 35.658, longitude: 139.701 };
    const nearby = place('本町駅', 35.658, 139.701);
    const duplicate = place('本町駅 (地下鉄)', 35.6582, 139.7012);
    const far = { ...place('本町駅', 34.6826, 135.498), locality: '大阪市', administrativeArea: '大阪府' };
    const results = distinctStations(origin, [nearby, duplicate, far], 3);
    expect(results).toHaveLength(2);
    expect(results[0].station.latitude).toBe(35.658);
    expect(results[1].station.latitude).toBe(34.6826);
  });

  it("keeps one entry per station, nearest first", () => {
    const origin = { latitude: 35.6595, longitude: 139.7005 };
    const stations = distinctStations(
      origin,
      [
        place("神泉駅", 35.6572, 139.6934),
        place("渋谷駅 (東京メトロ)", 35.6590, 139.7030),
        place("渋谷駅", 35.6580, 139.7016),
        place("渋谷駅前バス停", 35.6585, 139.7010),
      ],
      3,
    );
    expect(stations.map(({ station }) => station.nameJa)).toEqual(["渋谷", "神泉"]);
    expect(stations[0].station.regionJa).toBe("東京都渋谷区");
  });
});

describe("stationsFromSearch (the 「駅」 search)", () => {
  // Apple's answer near 山手 (35.43636, 139.64972), as on a Japanese iPhone.
  const here = { latitude: 35.436361, longitude: 139.649722 };
  const shop = { ...place("ニューヤマザキデイリーストア 元町中華街駅店", 35.44179, 139.65128), category: "MKPOICategoryFoodMarket" };
  const answer = [
    shop,
    place("元町・中華街駅", 35.4423, 139.65065),
    place("石川町駅", 35.43874, 139.64299),
    place("石川町駅南口タクシー乗り場", 35.43828, 139.64334),
    place("山手駅", 35.42685, 139.64642),
    place("伊勢佐木長者町駅", 35.44104, 139.63301),
    place("横浜駅", 35.46604, 139.62259),
  ];

  it("keeps railway stations within 2.5 km: shops, taxi ranks and far stations go", () => {
    const stations = stationsFromSearch(here, answer).filter(isRailwayStation);
    expect(stations.map(({ name }) => name)).toEqual(["元町・中華街駅", "石川町駅", "山手駅", "伊勢佐木長者町駅"]);
  });

  it("with nothing within 2.5 km (本牧, the harbour), the wider look keeps the nearest real stations", () => {
    const honmoku = { latitude: 35.4184, longitude: 139.6814 };
    expect(stationsFromSearch(honmoku, answer).filter(isRailwayStation)).toEqual([]);
    expect(stationsFromSearch(honmoku, answer, 5000).filter(isRailwayStation).map(({ name }) => name)).toEqual(["元町・中華街駅", "石川町駅", "山手駅"]);
  });

  it("so the closest three are the stations a walk away, not a 30-minute one", () => {
    const stations = distinctStations(here, stationsFromSearch(here, answer).filter(isRailwayStation), 3);
    expect(stations.map(({ station }) => station.nameJa)).toEqual(["石川町", "元町・中華街", "山手"]);
  });
});

describe("distinctStations: JR-prefixed names", () => {
  const here = { latitude: 35.4436, longitude: 139.6365 };
  it("「JR関内駅」 beside 「関内駅」 counts once, leaving room for another station", () => {
    const stations = distinctStations(here, [
      place("JR関内駅", 35.44328, 139.63702),
      place("関内駅", 35.44414, 139.63598),
      place("伊勢佐木長者町駅", 35.44104, 139.63301),
    ], 2);
    expect(stations.map(({ station }) => station.nameJa)).toEqual(["関内", "伊勢佐木長者町"]);
  });

  it("but JR難波 and 難波, apart, stay two stations", () => {
    const namba = { latitude: 34.6667, longitude: 135.4975 };
    const stations = distinctStations(namba, [place("JR難波駅", 34.6680, 135.4950), place("難波駅", 34.6650, 135.5010)], 3);
    expect(stations).toHaveLength(2);
  });
});

describe("taxi companies to call (no stand nearby)", () => {
  const company = (name: string, latitude: number, longitude: number, phone: string | null, category: string | null = null) => ({ ...place(name, latitude, longitude), phone, category });
  // Apple's answer to 「タクシー」 from the mountains near 三峰口 (35.90, 138.90).
  const mountains = { latitude: 35.9, longitude: 138.9 };
  const answer = [
    company("三峰口駅 タクシー乗り場", 35.95969, 138.97901, null, "MKPOICategoryPublicTransport"),
    company("丸通タクシー 小鹿野営業所", 36.02001, 139.00305, "+81 120598802"),
    company("アーク代行社", 35.99095, 139.08191, "+81 494 26 7739"),
    company("観光タクシー西武駅前営業所", 35.98917, 139.0844, "+81 494 22 5611"),
    company("秩父駅前タクシー乗り場", 35.99867, 139.08565, "+81 120023633", "MKPOICategoryPublicTransport"),
  ];

  it("keeps companies with a number: not stands, not 代行 (a driver for your own car)", () => {
    expect(taxiCompaniesFrom(mountains, answer, 20_000, 2).map(({ name, phone }) => [name, phone])).toEqual([
      ["丸通タクシー 小鹿野営業所", "0120-598-802"],
      ["観光タクシー西武駅前営業所", "0494-22-5611"],
    ]);
  });

  it("only within reach: Apple's far-off answers (Yokohama from 房総) are dropped", () => {
    const boso = { latitude: 35.19, longitude: 139.96 };
    expect(taxiCompaniesFrom(boso, [company("北斗タクシー", 35.43299, 139.66455, "+81 45 623 8884")], 20_000, 2)).toEqual([]);
  });

  it("numbers as dialled at home", () => {
    expect(domesticPhone("+81 45 623 8884")).toBe("045-623-8884");
    expect(domesticPhone("+81 120598802")).toBe("0120-598-802");
  });
});

describe("stationPlaces", () => {
  // Shibuya crossing. Apple's 「駅」 search over 2.5 km from here answered
  // 飯田橋, 半蔵門, 永田町… (4–7 km); over 1 km it answered 渋谷, 神泉, 恵比寿.
  const shibuya = { latitude: 35.6595, longitude: 139.7005 };
  const far = [place("永田町駅", 35.6787, 139.7403), place("飯田橋駅", 35.7021, 139.7452)];
  const local = [place("渋谷駅", 35.6580, 139.7016), place("神泉駅", 35.6573, 139.6935), place("恵比寿駅", 35.6467, 139.7101)];
  const maps = (byRadius: Record<number, typeof local | Error>) => ({
    searchPlaces: async (_query: string, _center: unknown, radius: number) => {
      const answer = byRadius[radius] ?? [];
      if (answer instanceof Error) throw answer;
      return answer;
    },
    nearbyStations: async () => [place("渋谷駅 - 0番のりば", 35.6593, 139.7006)],
  });

  it("finds the stations around Shibuya even when the 2.5 km search answers only far ones", async () => {
    const found = await stationPlaces(maps({ 1000: local, 2500: far }), shibuya);
    expect(distinctStations(shibuya, found, 3).map((s) => s.station.nameJa)).toEqual(["渋谷", "神泉", "恵比寿"]);
  });

  it("keeps the close search's answers out to 2.5 km, and the wider one's too", async () => {
    const yoyogi = place("代々木上原駅", 35.6690, 139.6797); // ~2.1 km
    const found = await stationPlaces(maps({ 1000: [local[0]], 2500: [yoyogi] }), shibuya);
    expect(found.map((p) => p.name).sort()).toEqual(["代々木上原駅", "渋谷駅"]);
  });

  it("looks out to 5 km when neither finds a station within 2.5 km", async () => {
    const found = await stationPlaces(maps({ 1000: far, 2500: far, 5000: far }), shibuya);
    expect(found.map((p) => p.name)).toEqual(["永田町駅"]);
  });

  it("prefers a real station farther off over a 「…駅」 that isn't one (横浜本牧: bus stop by a freight terminal)", async () => {
    const honmoku = { latitude: 35.418, longitude: 139.668 };
    const busStop = place("横浜本牧駅", 35.4234, 139.6714);
    const yamate = place("山手駅", 35.4272, 139.6463);
    const found = await stationPlaces(maps({ 1000: [busStop], 2500: [busStop], 5000: [busStop, yamate] }), honmoku);
    expect(found.map((p) => p.name)).toEqual(["山手駅"]);
    // A gondola stop beside real stations never wins either.
    const unga = place("運河パーク", 35.4538, 139.6339);
    const minatomirai = place("みなとみらい駅", 35.4575, 139.6325);
    const atUnga = { latitude: 35.4535, longitude: 139.6345 };
    expect((await stationPlaces(maps({ 1000: [unga, minatomirai], 2500: [] }), atUnga)).map((p) => p.name)).toEqual(["みなとみらい駅"]);
  });

  it("still uses a station missing from the list (opened since) when no known one is in reach", async () => {
    const somewhere = { latitude: 43.06, longitude: 141.95 };
    const brandNew = place("新しい駅", 43.062, 141.951);
    const found = await stationPlaces(maps({ 1000: [brandNew], 2500: [brandNew], 5000: [] }), somewhere);
    expect(distinctStations(somewhere, found, 3).map((s) => s.station.nameJa)).toEqual(["新しい"]);
  });

  it("uses one search when the other fails, and the nearby places only when both fail", async () => {
    expect((await stationPlaces(maps({ 1000: new Error("throttled"), 2500: local }), shibuya)).length).toBe(3);
    const fallback = await stationPlaces(maps({ 1000: new Error("x"), 2500: new Error("y") }), shibuya);
    expect(fallback.map((p) => p.name)).toEqual(["渋谷駅 - 0番のりば"]);
  });
});
