const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

require("dotenv").config();

const { AccessToken } = require("livekit-server-sdk");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

app.use(express.static("public"));


/* =========================
   참가자 스타일
========================= */

const TVP_EMOJIS = [
  "🤦",
  "🤗",
  "😗",
  "🤭",
  "😀",
  "🤔",
  "🥰",
  "🥺",
  "👀",
  "😯",
  "🤬",
  "😞",

  "😄",
  "😊",
  "😂",
  "😍",
  "😘",
  "😋",
  "😎",
  "😏",

  "😐",
  "😑",
  "😶",
  "🙄",
  "😒",
  "😔",
  "😢",
  "😭",
  "😴",
  "😵",

  "😳",
  "😮",
  "😱",

  "😠",
  "😤",
  "😬",
  "😈",
];


const TVP_COLORS = [
  "#8A0F25",
  "#70404A",

  "#C45100",
  "#75503A",

  "#987600",
  "#686036",

  "#007A3D",
  "#3F6650",

  "#007078",
  "#40666B",

  "#1057A3",
  "#3D5274",

  "#172F59",
  "#444D62",

  "#761FC7",
  "#685A75",

  "#9A176B",
  "#70475F",
];


function getRandomItem(array) {
  return array[
    Math.floor(
      Math.random() * array.length
    )
  ];
}


function getUnusedItem(
  items,
  usedItems
) {

  const unusedItems =
    items.filter(
      (item) =>
        !usedItems.includes(item)
    );


  if (unusedItems.length > 0) {
    return getRandomItem(
      unusedItems
    );
  }


  return getRandomItem(
    items
  );
}


/* =========================
   참가자 정보
========================= */

async function getRoomParticipants(
  roomId
) {

  const sockets =
    await io
      .in(roomId)
      .fetchSockets();


  return sockets.map(
    (client) => ({
      id: client.id,

      nickname:
        client.data.nickname ||
        "관객",

      isHost:
        !!client.data.isHost,

      emoji:
        client.data.emoji ||
        "🙂",

      color:
        client.data.color ||
        "#444D62",
    })
  );
}


async function createParticipantStyle(
  roomId
) {

  const participants =
    await getRoomParticipants(
      roomId
    );


  const usedEmojis =
    participants
      .map(
        (participant) =>
          participant.emoji
      )
      .filter(Boolean);


  const usedColors =
    participants
      .map(
        (participant) =>
          participant.color
      )
      .filter(Boolean);


  return {
    emoji:
      getUnusedItem(
        TVP_EMOJIS,
        usedEmojis
      ),

    color:
      getUnusedItem(
        TVP_COLORS,
        usedColors
      ),
  };
}


async function updateParticipants(
  roomId
) {

  const participants =
    await getRoomParticipants(
      roomId
    );


  io.to(roomId).emit(
    "participant-update",
    {
      count:
        participants.length,

      participants,
    }
  );
}


/* =========================
   LiveKit 토큰
========================= */

app.get(
  "/token",
  async (req, res) => {

    try {

      const room =
        req.query.room ||
        "test-room";


      const username =
        req.query.username ||
        "guest";


      const token =
        new AccessToken(
          process.env.LIVEKIT_API_KEY,
          process.env.LIVEKIT_API_SECRET,
          {
            identity:
              username,
          }
        );


      token.addGrant({
        roomJoin: true,
        room,
        canPublish: true,
        canSubscribe: true,
      });


      res.json({
        token:
          await token.toJwt(),

        url:
          process.env.LIVEKIT_URL,
      });


    } catch (error) {

      console.error(error);


      res.status(500).json({
        error:
          "토큰 생성 실패",
      });

    }

  }
);


/* =========================
   Socket.IO
========================= */

io.on(
  "connection",
  (socket) => {


    console.log(
      "사용자 접속:",
      socket.id
    );


    /* -------------------------
       방 입장
    ------------------------- */

    socket.on(
      "join-room",
      async ({
        roomId,
        nickname,
        isHost
      }) => {


        if (!roomId) {
          return;
        }


        const trimmedNickname =
          String(
            nickname || "관객"
          ).trim();


        const existingSockets =
          await io
            .in(roomId)
            .fetchSockets();


        const duplicateNickname =
          existingSockets.some(
            (client) =>
              client.data.nickname ===
              trimmedNickname
          );


        if (duplicateNickname) {

          socket.emit(
            "nickname-error",
            {
              message:
                "이미 사용 중인 닉네임입니다.",
            }
          );

          return;
        }


        /*
         * 스타일은 방에 들어가기 전에 배정.
         * 그래야 자기 자신이 used 목록에
         * 들어가지 않는다.
         */

        const style =
          await createParticipantStyle(
            roomId
          );


        socket.data.roomId =
          roomId;


        socket.data.nickname =
          trimmedNickname;


        socket.data.isHost =
          !!isHost;


        socket.data.emoji =
          style.emoji;


        socket.data.color =
          style.color;


        socket.join(
          roomId
        );


        await updateParticipants(
          roomId
        );


        socket
          .to(roomId)
          .emit(
            "system-message",
            {
              message:
                `${trimmedNickname}님이 입장했습니다.`,
            }
          );

      }
    );


    /* -------------------------
       닉네임 변경
    ------------------------- */

    socket.on(
      "change-nickname",
      async ({
        roomId,
        nickname
      }) => {


        if (
          !roomId ||
          !nickname
        ) {
          return;
        }


        const newNickname =
          String(
            nickname
          ).trim();


        if (!newNickname) {
          return;
        }


        const sockets =
          await io
            .in(roomId)
            .fetchSockets();


        const duplicateNickname =
          sockets.some(
            (client) =>
              client.id !==
                socket.id &&
              client.data.nickname ===
                newNickname
          );


        if (duplicateNickname) {

          socket.emit(
            "nickname-error",
            {
              message:
                "이미 사용 중인 닉네임입니다.",
            }
          );

          return;
        }


        const oldNickname =
          socket.data.nickname;


        socket.data.nickname =
          newNickname;


        io.to(roomId).emit(
          "system-message",
          {
            message:
              `${oldNickname}님이 ${newNickname}님으로 다시 태어났습니다.`,
          }
        );


        await updateParticipants(
          roomId
        );

      }
    );


    /* -------------------------
       채팅
    ------------------------- */

    socket.on(
      "chat-message",
      ({
        roomId,
        message,
        replyTo
      }) => {


        if (
          !roomId ||
          !message
        ) {
          return;
        }


        const trimmedMessage =
          String(message).trim();


        if (!trimmedMessage) {
          return;
        }


        let cleanReplyTo =
          null;


        if (
          replyTo &&
          typeof replyTo ===
            "object"
        ) {

          cleanReplyTo = {
            socketId:
              String(
                replyTo.socketId ||
                ""
              ),

            nickname:
              String(
                replyTo.nickname ||
                ""
              ),

            message:
              String(
                replyTo.message ||
                ""
              ),

            emoji:
              String(
                replyTo.emoji ||
                "🙂"
              ),
          };

        }


        io.to(roomId).emit(
          "chat-message",
          {
            socketId:
              socket.id,

            username:
              socket.data.nickname ||
              "관객",

            message:
              trimmedMessage,

            emoji:
              socket.data.emoji ||
              "🙂",

            color:
              socket.data.color ||
              "#444D62",

            replyTo:
              cleanReplyTo,
          }
        );

      }
    );


        /* -------------------------
       화면 공유 상태
    ------------------------- */

    socket.on(
      "screen-share-state",
      ({
        roomId,
        sharing
      }) => {

        if (!roomId) {
          return;
        }

        /*
         * 방장만 공유 상태를
         * 변경할 수 있음
         */

        if (!socket.data.isHost) {
          return;
        }

        socket
          .to(roomId)
          .emit(
            "screen-share-state",
            {
              sharing:
                !!sharing
            }
          );

      }
    );
    
    /* -------------------------
       퇴장
    ------------------------- */

    socket.on(
      "disconnect",
      async () => {


        console.log(
          "사용자 퇴장:",
          socket.id
        );


        const roomId =
          socket.data.roomId;


        const nickname =
          socket.data.nickname;


        if (!roomId) {
          return;
        }


        await updateParticipants(
          roomId
        );


        if (nickname) {

          io.to(roomId).emit(
            "system-message",
            {
              message:
                `${nickname}님이 퇴장했습니다.`,
            }
          );

        }

      }
    );

  }
);


/* =========================
   서버 시작
========================= */

const PORT =
  process.env.PORT ||
  3000;


server.listen(
  PORT,
  () => {

    console.log(
      `Zip Screen 서버 실행 중: http://localhost:${PORT}`
    );

  }
);