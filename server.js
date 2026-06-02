import express from "express";
import http from "http";
import crypto from "crypto";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);
// Socket.IO: 앱(다른 출처)에서의 연결 허용 + 백그라운드 끊김 방지를 위해 ping 타임아웃 넉넉히
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingInterval: 25000,
  pingTimeout: 60000,
});

// CORS 허용 — 네이티브 앱(https://localhost 등 다른 출처)에서 API 호출 가능하게
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/**
 * 방(room) 상태를 메모리에 저장.
 * key   = 무작위 방 코드 (URL에 노출되는 식별자, 전화번호 아님)
 * value = { code, phone, hostOnline, lastLocation, viewers:Set, hostSocketId }
 *   - phone(호스트 번호)은 서버에만 보관하며 URL·시청자에게 절대 노출하지 않음
 */
const rooms = new Map();

// 전화번호 정규화: 숫자만 남김 (010-1234-5678 → 01012345678)
function normalizePhone(raw) {
  return String(raw || "").replace(/\D/g, "");
}

// 혼동되는 글자(I,O,0,1) 제외한 6자리 방 코드 생성
function genRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    const bytes = crypto.randomBytes(6);
    code = Array.from(bytes).map((b) => alphabet[b % alphabet.length]).join("");
  } while (rooms.has(code));
  return code;
}

function roomKey(code) {
  return `room:${code}`;
}

// 방이 없으면 자동 생성 (고정 방 지원: POST 없이 host/viewer가 바로 입장 가능)
function ensureRoom(code) {
  let r = rooms.get(code);
  if (!r) {
    r = {
      code,
      phone: null,
      hostOnline: false,
      lastLocation: null,
      viewers: new Set(),
      hostSocketId: null,
    };
    rooms.set(code, r);
  }
  return r;
}

function broadcastStats(code) {
  const room = rooms.get(code);
  if (!room) return;
  io.to(roomKey(code)).emit("room:stats", {
    viewerCount: room.viewers.size,
    hostOnline: room.hostOnline,
  });
}

// ---- 호스트가 전화번호로 방 생성 → 무작위 방 코드 반환 ----
app.post("/api/room", (req, res) => {
  const phone = normalizePhone(req.body && req.body.phone);
  if (!phone || phone.length < 8) {
    return res.status(400).json({ error: "유효한 전화번호가 아닙니다." });
  }
  const code = genRoomCode();
  rooms.set(code, {
    code,
    phone, // 서버에만 보관
    hostOnline: false,
    lastLocation: null,
    viewers: new Set(),
    hostSocketId: null,
  });
  console.log(`[room:create] code=${code}`);
  res.json({ room: code });
});

io.on("connection", (socket) => {
  let role = null; // 'host' | 'viewer'
  let code = null; // 방 코드

  // ---- 호스트가 위치 공유 시작 ----
  socket.on("host:join", ({ room }) => {
    code = String(room || "").toUpperCase();
    if (!code) { socket.emit("error:msg", "방 코드가 없습니다."); return; }
    const r = ensureRoom(code);
    if (r.hostOnline && r.hostSocketId && r.hostSocketId !== socket.id) {
      socket.emit("error:msg", "이미 이 방에서 공유 중인 호스트가 있습니다.");
      return;
    }
    role = "host";
    // 재연결 유예 타이머가 있으면 취소 (잠깐 끊겼다 돌아온 것)
    if (r.hostGraceTimer) { clearTimeout(r.hostGraceTimer); r.hostGraceTimer = null; }
    r.hostOnline = true;
    r.hostSocketId = socket.id;
    socket.join(roomKey(code));
    socket.emit("host:joined", { room: code, lastLocation: r.lastLocation });
    broadcastStats(code);
    console.log(`[host:join] room=${code}`);
  });

  // ---- 하트비트(연결 유지용, 별도 처리 불필요) ----
  socket.on("host:heartbeat", () => {});

  // ---- 호스트가 위치 갱신 ----
  socket.on("host:location", (loc) => {
    if (role !== "host" || !code) return;
    const r = rooms.get(code);
    if (!r) return;
    const safe = {
      lat: Number(loc.lat),
      lng: Number(loc.lng),
      accuracy: Number(loc.accuracy) || null,
      ts: Date.now(),
    };
    if (!isFinite(safe.lat) || !isFinite(safe.lng)) return;
    r.lastLocation = safe;
    socket.to(roomKey(code)).emit("location:update", safe);
  });

  // ---- 시청자가 입장 ----
  socket.on("viewer:join", ({ room }) => {
    code = String(room || "").toUpperCase();
    if (!code) { socket.emit("error:msg", "방 코드가 없습니다."); return; }
    const r = ensureRoom(code);
    role = "viewer";
    r.viewers.add(socket.id);
    socket.join(roomKey(code));
    socket.emit("viewer:joined", {
      room: code,
      hostOnline: r.hostOnline,
      lastLocation: r.lastLocation,
    });
    broadcastStats(code);
    console.log(`[viewer:join] room=${code} viewers=${r.viewers.size}`);
  });

  // ---- 연결 종료 처리 ----
  socket.on("disconnect", () => {
    if (!code) return;
    const r = rooms.get(code);
    if (!r) return;

    if (role === "host" && r.hostSocketId === socket.id) {
      // 즉시 오프라인 처리하지 않고 45초 유예 — 잠깐 끊겼다 재연결하면 세션 유지
      r.hostSocketId = null;
      console.log(`[host:drop] room=${code} (유예 시작)`);
      if (r.hostGraceTimer) clearTimeout(r.hostGraceTimer);
      r.hostGraceTimer = setTimeout(() => {
        r.hostGraceTimer = null;
        if (!r.hostSocketId) {
          // 유예 동안 재연결 없음 → 진짜 오프라인
          r.hostOnline = false;
          io.to(roomKey(code)).emit("host:offline");
          broadcastStats(code);
          console.log(`[host:offline] room=${code}`);
          if (!r.hostOnline && r.viewers.size === 0) rooms.delete(code);
        }
      }, 45000);
    } else if (role === "viewer") {
      r.viewers.delete(socket.id);
    }
    broadcastStats(code);

    // 호스트 유예 중이거나 온라인이면 방 유지
    if (!r.hostOnline && !r.hostGraceTimer && r.viewers.size === 0) {
      rooms.delete(code);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`여기양 서버 실행 중 → http://localhost:${PORT}`);
});
