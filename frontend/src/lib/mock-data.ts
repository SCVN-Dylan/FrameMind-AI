// DEMO DATA ONLY.
// Nothing in this file is produced by AI or by looking at real videos. It exists so the UI can be
// built and tested before the analysis backend (M4–M6) is ready. Every screen that shows this data
// must label it as "Demo".

import type { Language } from "./i18n/dictionaries";
import type { AnalysisRange, AnalysisRecord, FeedbackItem } from "./types";

type FeedbackText = Pick<FeedbackItem, "title" | "summary" | "referenceNote" | "currentNote" | "unityFix">;

type FeedbackTemplate = Pick<FeedbackItem, "category" | "severity"> & {
  /** Where the item sits in the video, as a fraction of its length (0–1). */
  at: number;
  text: Record<Language, FeedbackText>;
};

const DEMO_TEMPLATES: FeedbackTemplate[] = [
  {
    at: 0.07,
    category: "camera",
    severity: "major",
    text: {
      en: {
        title: "Camera follow is too stiff during sprint",
        summary:
          "The reference camera lags slightly behind the player when sprinting, which sells speed. The current camera is locked to the player and feels rigid.",
        referenceNote: "Camera trails the character by ~0.3s and eases back when the sprint ends.",
        currentNote: "Camera is hard-locked to the character; no lag or easing is visible.",
        unityFix: [
          "Select the CinemachineCamera following the player.",
          "In the Position Composer (or Follow) component, raise Damping X/Z from 0 to about 0.4–0.6.",
          "Add a Cinemachine Impulse Source on sprint start for a subtle kick.",
        ],
      },
      vi: {
        title: "Camera bám theo quá cứng khi chạy nhanh",
        summary:
          "Camera trong video tham chiếu trễ nhẹ phía sau nhân vật khi chạy nhanh, tạo cảm giác tốc độ. Camera hiện tại bị khóa cứng vào nhân vật nên trông thiếu tự nhiên.",
        referenceNote: "Camera theo sau nhân vật khoảng 0.3s và từ từ trở lại khi ngừng chạy nhanh.",
        currentNote: "Camera khóa cứng vào nhân vật, không có độ trễ hay chuyển động mượt.",
        unityFix: [
          "Chọn CinemachineCamera đang follow nhân vật.",
          "Trong component Position Composer (hoặc Follow), tăng Damping X/Z từ 0 lên khoảng 0.4–0.6.",
          "Thêm Cinemachine Impulse Source khi bắt đầu chạy nhanh để tạo cú rung nhẹ.",
        ],
      },
      ko: {
        title: "스프린트 중 카메라 추적이 너무 딱딱함",
        summary:
          "레퍼런스 카메라는 스프린트 시 플레이어보다 약간 뒤처져 속도감을 줍니다. 현재 카메라는 플레이어에 고정되어 있어 경직된 느낌입니다.",
        referenceNote: "카메라가 캐릭터를 약 0.3초 늦게 따라가며 스프린트가 끝나면 부드럽게 복귀합니다.",
        currentNote: "카메라가 캐릭터에 완전히 고정되어 지연이나 이징이 보이지 않습니다.",
        unityFix: [
          "플레이어를 따라가는 CinemachineCamera를 선택합니다.",
          "Position Composer(또는 Follow) 컴포넌트에서 Damping X/Z를 0에서 약 0.4–0.6으로 올립니다.",
          "스프린트 시작 시 Cinemachine Impulse Source를 추가해 가벼운 반동을 줍니다.",
        ],
      },
    },
  },
  {
    at: 0.19,
    category: "composition",
    severity: "minor",
    text: {
      en: {
        title: "Player is centered instead of on the thirds line",
        summary:
          "The reference frames the character on the left third, leaving room in the direction of travel. The current shot keeps the character dead center.",
        referenceNote: "Character sits on the left third with open space ahead.",
        currentNote: "Character is centered; the frame feels static and the path ahead is cropped.",
        unityFix: [
          "On the CinemachineCamera, open the Position Composer.",
          "Set Screen Position X to about -0.15 so the player sits left of center.",
          "Enable Lookahead (Time ≈ 0.3) so the frame leads in the movement direction.",
        ],
      },
      vi: {
        title: "Nhân vật nằm giữa khung thay vì trên đường một phần ba",
        summary:
          "Video tham chiếu đặt nhân vật ở một phần ba bên trái, chừa khoảng trống theo hướng di chuyển. Cảnh hiện tại giữ nhân vật ngay chính giữa.",
        referenceNote: "Nhân vật nằm ở một phần ba bên trái, phía trước có khoảng trống.",
        currentNote: "Nhân vật ở chính giữa; khung hình tĩnh và đường phía trước bị cắt.",
        unityFix: [
          "Trên CinemachineCamera, mở Position Composer.",
          "Đặt Screen Position X khoảng -0.15 để nhân vật lệch sang trái.",
          "Bật Lookahead (Time ≈ 0.3) để khung hình đón trước hướng di chuyển.",
        ],
      },
      ko: {
        title: "플레이어가 3분할선이 아닌 중앙에 위치함",
        summary:
          "레퍼런스는 캐릭터를 왼쪽 3분할선에 두어 진행 방향에 여백을 남깁니다. 현재 샷은 캐릭터를 정중앙에 둡니다.",
        referenceNote: "캐릭터가 왼쪽 3분할선에 있고 앞쪽에 여백이 있습니다.",
        currentNote: "캐릭터가 중앙에 있어 화면이 정적이고 앞 경로가 잘립니다.",
        unityFix: [
          "CinemachineCamera에서 Position Composer를 엽니다.",
          "Screen Position X를 약 -0.15로 설정해 플레이어를 중앙 왼쪽에 둡니다.",
          "Lookahead(Time ≈ 0.3)를 켜서 이동 방향을 미리 보여 줍니다.",
        ],
      },
    },
  },
  {
    at: 0.33,
    category: "lighting",
    severity: "major",
    text: {
      en: {
        title: "Scene is flat — missing rim light on the character",
        summary:
          "The reference separates the hero from the background with a strong rim light. In the current gameplay the character blends into the environment.",
        referenceNote: "Warm rim light outlines the character's silhouette from behind.",
        currentNote: "Lighting is mostly ambient; the silhouette disappears against the background.",
        unityFix: [
          "Add a Spot or Directional light behind the character, angled toward the camera.",
          "Use a warm color (≈ #FFB070) at a higher intensity than the key light.",
          "If using URP, set the light's Rendering Layers so it only affects the character.",
        ],
      },
      vi: {
        title: "Cảnh bị phẳng — thiếu rim light cho nhân vật",
        summary:
          "Video tham chiếu tách nhân vật khỏi nền bằng rim light mạnh. Trong gameplay hiện tại, nhân vật bị hòa lẫn vào môi trường.",
        referenceNote: "Rim light ấm viền quanh dáng nhân vật từ phía sau.",
        currentNote: "Ánh sáng chủ yếu là ambient; dáng nhân vật chìm vào nền.",
        unityFix: [
          "Thêm một Spot hoặc Directional light phía sau nhân vật, chiếu hướng về camera.",
          "Dùng màu ấm (≈ #FFB070) với cường độ cao hơn key light.",
          "Nếu dùng URP, đặt Rendering Layers của đèn để chỉ ảnh hưởng tới nhân vật.",
        ],
      },
      ko: {
        title: "장면이 밋밋함 — 캐릭터에 림 라이트 없음",
        summary:
          "레퍼런스는 강한 림 라이트로 주인공을 배경과 분리합니다. 현재 게임플레이에서는 캐릭터가 환경에 묻힙니다.",
        referenceNote: "따뜻한 림 라이트가 뒤에서 캐릭터 실루엣을 감쌉니다.",
        currentNote: "대부분 앰비언트 조명이라 실루엣이 배경에 묻힙니다.",
        unityFix: [
          "캐릭터 뒤에 카메라를 향하는 Spot 또는 Directional 라이트를 추가합니다.",
          "키 라이트보다 높은 강도의 따뜻한 색(≈ #FFB070)을 사용합니다.",
          "URP를 사용한다면 라이트의 Rendering Layers를 설정해 캐릭터에만 적용합니다.",
        ],
      },
    },
  },
  {
    at: 0.46,
    category: "colors",
    severity: "minor",
    text: {
      en: {
        title: "Color grading is less saturated than the reference",
        summary:
          "The reference uses a teal/orange grade with punchy saturation. The current gameplay looks washed out, especially in the midtones.",
        referenceNote: "Saturated teal shadows and warm highlights.",
        currentNote: "Neutral grade; midtones look grey and contrast is low.",
        unityFix: [
          "Open the Global Volume profile and add (or edit) Color Adjustments.",
          "Raise Saturation to about +15 and Contrast to about +10.",
          "Add Split Toning: shadows toward teal, highlights toward orange, Balance ≈ -20.",
        ],
      },
      vi: {
        title: "Color grading kém bão hòa hơn video tham chiếu",
        summary:
          "Video tham chiếu dùng tông teal/orange với độ bão hòa mạnh. Gameplay hiện tại trông bị nhạt, đặc biệt ở vùng trung tính.",
        referenceNote: "Vùng tối ngả teal đậm, vùng sáng ấm.",
        currentNote: "Tông màu trung tính; vùng trung tính xám và độ tương phản thấp.",
        unityFix: [
          "Mở profile của Global Volume và thêm (hoặc chỉnh) Color Adjustments.",
          "Tăng Saturation lên khoảng +15 và Contrast lên khoảng +10.",
          "Thêm Split Toning: shadows ngả teal, highlights ngả cam, Balance ≈ -20.",
        ],
      },
      ko: {
        title: "컬러 그레이딩 채도가 레퍼런스보다 낮음",
        summary:
          "레퍼런스는 강한 채도의 틸/오렌지 그레이드를 사용합니다. 현재 게임플레이는 특히 중간톤이 바래 보입니다.",
        referenceNote: "채도 높은 틸 계열 그림자와 따뜻한 하이라이트.",
        currentNote: "중립적인 그레이드로 중간톤이 회색이고 대비가 낮습니다.",
        unityFix: [
          "Global Volume 프로필을 열고 Color Adjustments를 추가(또는 수정)합니다.",
          "Saturation을 약 +15, Contrast를 약 +10으로 올립니다.",
          "Split Toning 추가: 그림자는 틸, 하이라이트는 오렌지, Balance ≈ -20.",
        ],
      },
    },
  },
  {
    at: 0.6,
    category: "animation",
    severity: "suggestion",
    text: {
      en: {
        title: "Landing animation has no anticipation squash",
        summary:
          "In the reference, the character compresses briefly on landing. The current landing snaps straight to idle.",
        referenceNote: "2–3 frame squash followed by a quick recovery.",
        currentNote: "Land → Idle transition is instant with no weight.",
        unityFix: [
          "In the Animator, add a short 'Land' state between Fall and Idle.",
          "Set the Fall → Land transition to Has Exit Time off, Transition Duration ≈ 0.05.",
          "Use a landing clip with a squash pose, or scale the root bone briefly via an Animation Event.",
        ],
      },
      vi: {
        title: "Animation tiếp đất thiếu nhún (squash)",
        summary:
          "Trong video tham chiếu, nhân vật nhún xuống một chút khi tiếp đất. Hiện tại nhân vật chuyển thẳng sang idle.",
        referenceNote: "Nhún 2–3 frame rồi hồi lại nhanh.",
        currentNote: "Chuyển Land → Idle tức thì, không có cảm giác trọng lượng.",
        unityFix: [
          "Trong Animator, thêm một state 'Land' ngắn giữa Fall và Idle.",
          "Đặt transition Fall → Land: tắt Has Exit Time, Transition Duration ≈ 0.05.",
          "Dùng clip tiếp đất có tư thế nhún, hoặc scale root bone một chút qua Animation Event.",
        ],
      },
      ko: {
        title: "착지 애니메이션에 스쿼시가 없음",
        summary: "레퍼런스에서는 캐릭터가 착지할 때 잠깐 눌립니다. 현재 착지는 바로 idle로 전환됩니다.",
        referenceNote: "2–3프레임 스쿼시 후 빠르게 회복합니다.",
        currentNote: "Land → Idle 전환이 즉시 일어나 무게감이 없습니다.",
        unityFix: [
          "Animator에서 Fall과 Idle 사이에 짧은 'Land' 스테이트를 추가합니다.",
          "Fall → Land 전환에서 Has Exit Time을 끄고 Transition Duration ≈ 0.05로 설정합니다.",
          "스쿼시 포즈가 있는 착지 클립을 사용하거나 Animation Event로 루트 본을 잠시 스케일합니다.",
        ],
      },
    },
  },
  {
    at: 0.74,
    category: "vfx",
    severity: "minor",
    text: {
      en: {
        title: "Hit impact lacks particles and flash",
        summary:
          "The reference shows a bright flash, sparks and a short hit-stop on impact. The current hit has no visual punctuation.",
        referenceNote: "White flash on the enemy, spark burst and ~60ms hit-stop.",
        currentNote: "Enemy health drops but no impact VFX plays.",
        unityFix: [
          "Create a Particle System (or VFX Graph) burst: 15–25 sparks, lifetime 0.2s.",
          "Spawn it at the hit point from your damage script.",
          "Add a hit-stop by setting Time.timeScale = 0.05 for ~0.06s, then restoring it.",
        ],
      },
      vi: {
        title: "Đòn đánh trúng thiếu particle và hiệu ứng lóe sáng",
        summary:
          "Video tham chiếu có lóe sáng, tia lửa và hit-stop ngắn khi trúng đòn. Đòn đánh hiện tại không có điểm nhấn hình ảnh.",
        referenceNote: "Kẻ địch lóe trắng, bắn tia lửa và hit-stop khoảng 60ms.",
        currentNote: "Máu kẻ địch giảm nhưng không có VFX va chạm.",
        unityFix: [
          "Tạo burst bằng Particle System (hoặc VFX Graph): 15–25 tia lửa, lifetime 0.2s.",
          "Spawn nó tại điểm trúng đòn từ script gây sát thương.",
          "Thêm hit-stop: đặt Time.timeScale = 0.05 trong khoảng 0.06s rồi khôi phục.",
        ],
      },
      ko: {
        title: "타격 시 파티클과 플래시가 없음",
        summary:
          "레퍼런스는 타격 시 밝은 플래시, 스파크, 짧은 히트스톱을 보여 줍니다. 현재 타격에는 시각적 강조가 없습니다.",
        referenceNote: "적에게 흰색 플래시, 스파크 버스트, 약 60ms 히트스톱.",
        currentNote: "적 체력은 줄지만 타격 VFX가 재생되지 않습니다.",
        unityFix: [
          "Particle System(또는 VFX Graph) 버스트 생성: 스파크 15–25개, lifetime 0.2초.",
          "데미지 스크립트에서 타격 지점에 스폰합니다.",
          "Time.timeScale = 0.05를 약 0.06초 동안 적용한 뒤 복원해 히트스톱을 추가합니다.",
        ],
      },
    },
  },
  {
    at: 0.88,
    category: "camera",
    severity: "suggestion",
    text: {
      en: {
        title: "Field of view does not widen at high speed",
        summary:
          "The reference widens the FOV slightly during the dash to emphasize speed. The current FOV is constant.",
        referenceNote: "FOV goes from ~60° to ~70° during the dash.",
        currentNote: "FOV stays fixed at 60°.",
        unityFix: [
          "Expose the CinemachineCamera Lens → Field Of View in your dash script.",
          "Lerp it to +8–10° over 0.15s when the dash starts and back when it ends.",
        ],
      },
      vi: {
        title: "Góc nhìn (FOV) không mở rộng khi di chuyển nhanh",
        summary: "Video tham chiếu mở rộng FOV một chút khi lướt (dash) để nhấn mạnh tốc độ. FOV hiện tại cố định.",
        referenceNote: "FOV tăng từ ~60° lên ~70° khi dash.",
        currentNote: "FOV giữ cố định ở 60°.",
        unityFix: [
          "Truy cập CinemachineCamera Lens → Field Of View trong script dash.",
          "Lerp tăng 8–10° trong 0.15s khi bắt đầu dash và trả về khi kết thúc.",
        ],
      },
      ko: {
        title: "고속 이동 시 시야각이 넓어지지 않음",
        summary: "레퍼런스는 대시 중 FOV를 약간 넓혀 속도감을 강조합니다. 현재 FOV는 고정되어 있습니다.",
        referenceNote: "대시 중 FOV가 약 60°에서 약 70°로 바뀝니다.",
        currentNote: "FOV가 60°로 고정되어 있습니다.",
        unityFix: [
          "대시 스크립트에서 CinemachineCamera Lens → Field Of View에 접근합니다.",
          "대시 시작 시 0.15초 동안 +8–10°로 Lerp하고 종료 시 되돌립니다.",
        ],
      },
    },
  },
];

/**
 * Builds DEMO feedback placed inside the given ranges so markers line up with what was "analysed".
 * For a single frame, pass a zero-length range (start = end). This does not analyse the videos.
 */
export function createDemoFeedbackInRange(range: AnalysisRange, language: Language = "en"): FeedbackItem[] {
  const at = (fraction: number, start: number, end: number) => Math.round(start + fraction * (end - start));
  return DEMO_TEMPLATES.map(({ at: fraction, text, ...template }, index) => ({
    ...template,
    ...text[language],
    id: `demo-${index + 1}`,
    currentMs: at(fraction, range.currentStartMs, range.currentEndMs),
    referenceMs: at(fraction, range.referenceStartMs, range.referenceEndMs),
  }));
}

/** DEMO feedback spread across whole videos. */
export function createDemoFeedback(
  currentDurationMs: number,
  referenceDurationMs: number,
  language: Language = "en",
): FeedbackItem[] {
  return createDemoFeedbackInRange(
    { referenceStartMs: 0, referenceEndMs: referenceDurationMs, currentStartMs: 0, currentEndMs: currentDurationMs },
    language,
  ).map((item) => ({ ...item, currentMs: roundTo100(item.currentMs), referenceMs: roundTo100(item.referenceMs) }));
}

function roundTo100(ms: number): number {
  return Math.round(ms / 100) * 100;
}

type HistoryTemplate = Omit<AnalysisRecord, "title" | "feedback"> & {
  title: Record<Language, string>;
  feedback: (language: Language) => FeedbackItem[];
};

const HISTORY_TEMPLATES: HistoryTemplate[] = [
  {
    id: "boss-arena-v3",
    title: {
      en: "Boss arena — intro cinematic",
      vi: "Đấu trường boss — cinematic mở đầu",
      ko: "보스 아레나 — 인트로 시네마틱",
    },
    createdAt: "2026-10-26T16:20:00Z",
    referenceVideo: "boss_intro_reference.mp4",
    currentVideo: "boss_intro_build_0412.mp4",
    durationMs: 48_000,
    status: "completed",
    feedback: (language) => createDemoFeedback(48_000, 52_000, language),
  },
  {
    id: "forest-traversal",
    title: {
      en: "Forest traversal — sprint & jump",
      vi: "Băng rừng — chạy nhanh & nhảy",
      ko: "숲 이동 — 스프린트 & 점프",
    },
    createdAt: "2026-10-24T09:05:00Z",
    referenceVideo: "forest_run_ref.mov",
    currentVideo: "forest_run_playtest_12.mp4",
    durationMs: 36_000,
    status: "completed",
    feedback: (language) => createDemoFeedback(36_000, 36_000, language).slice(0, 5),
  },
  {
    id: "city-night-combat",
    title: {
      en: "City night — combat lighting",
      vi: "Thành phố đêm — ánh sáng chiến đấu",
      ko: "야간 도시 — 전투 조명",
    },
    createdAt: "2026-10-22T19:40:00Z",
    referenceVideo: "city_combat_target.mp4",
    currentVideo: "city_combat_wip.mp4",
    durationMs: 62_000,
    status: "processing",
    feedback: () => [],
  },
  {
    id: "menu-transition",
    title: {
      en: "Main menu → gameplay transition",
      vi: "Chuyển cảnh menu chính → gameplay",
      ko: "메인 메뉴 → 게임플레이 전환",
    },
    createdAt: "2026-10-19T11:12:00Z",
    referenceVideo: "menu_transition_ref.mp4",
    currentVideo: "menu_transition_v2.webm",
    durationMs: 14_000,
    status: "failed",
    feedback: () => [],
  },
  {
    id: "desert-vfx-pass",
    title: {
      en: "Desert level — VFX pass",
      vi: "Màn sa mạc — chỉnh VFX",
      ko: "사막 레벨 — VFX 패스",
    },
    createdAt: "2026-10-15T13:30:00Z",
    referenceVideo: "desert_vfx_reference.mp4",
    currentVideo: "desert_vfx_build_0398.mp4",
    durationMs: 40_000,
    status: "completed",
    feedback: (language) => createDemoFeedback(40_000, 44_000, language).filter((item) => item.severity !== "suggestion"),
  },
  {
    id: "character-select",
    title: {
      en: "Character select screen",
      vi: "Màn hình chọn nhân vật",
      ko: "캐릭터 선택 화면",
    },
    createdAt: "2026-10-12T08:45:00Z",
    referenceVideo: "char_select_ref.mp4",
    currentVideo: "—",
    durationMs: 0,
    status: "draft",
    feedback: () => [],
  },
];

export const DEMO_ANALYSIS_IDS = HISTORY_TEMPLATES.map((record) => record.id);

export function getDemoHistory(language: Language = "en"): AnalysisRecord[] {
  return HISTORY_TEMPLATES.map((record) => ({
    ...record,
    title: record.title[language],
    feedback: record.feedback(language),
  }));
}

export function getDemoAnalysis(id: string, language: Language = "en"): AnalysisRecord | undefined {
  return getDemoHistory(language).find((record) => record.id === id);
}
