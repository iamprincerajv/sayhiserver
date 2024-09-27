const { Server } = require("socket.io");
const mysql = require("mysql2");
const sendEmail = require("./utils/sendEmail");
require("dotenv").config();

const io = new Server(8000, {
  cors: true,
});

// MySQL connection setup
const connection = mysql.createConnection({
  host: process.env.HOST,
  user: process.env.USER,
  password: process.env.PASSWORD,
  database: process.env.DATABASE,
});

connection.connect((err) => {
  if (err) {
    console.error("Error connecting to MySQL:", err.stack);
    return;
  }
  console.log("Connected to MySQL as id " + connection.threadId);
});

const emailToSocketIdMap = new Map();
const socketIdToEmail = new Map();

io.on("connection", (socket) => {
  console.log("Socket", socket.id);

  socket.on("room:join", (data) => {
    const { email, room } = data;
    emailToSocketIdMap.set(email, socket.id);
    socketIdToEmail.set(socket.id, email);
    io.to(room).emit("user:joined", { email, id: socket.id });
    socket.join(room);
    io.to(socket.id).emit("room:join", data);
  });

  socket.on("user:call", ({ to, offer }) => {
    io.to(to).emit("incoming:call", { from: socket.id, offer });
  });

  socket.on("call:accepted", ({ to, ans }) => {
    io.to(to).emit("call:accepted", { from: socket.id, ans });
  });

  socket.on("peer:nego:needed", ({ to, offer }) => {
    io.to(to).emit("peer:nego:needed", { from: socket.id, offer });
  });

  socket.on("peer:nego:done", ({ to, ans }) => {
    io.to(to).emit("peer:nego:final", { from: socket.id, ans });
  });

  // DB operations
  // SIGNUP
  socket.on("signup", (data) => {
    connection.query(
      "SELECT * FROM users WHERE email = ?",
      [data.email],
      (error, results) => {
        if (error) {
          console.log("error 1", error.message);
          io.to(socket.id).emit("signup:error", { error: error.message });
          return;
        }
        if (results.length > 0) {
          io.to(socket.id).emit("signup:error", {
            error: "User already exists with this email",
          });
          return;
        }

        const query =
          "INSERT INTO users (name, email, password) VALUES (?, ? , ?)";
        console.log("incoming data", data);
        connection.query(
          query,
          [data.name, data.email, data.password],
          async (error, results) => {
            if (error) {
              console.log("error 2", error.message);
              io.to(socket.id).emit("signup:error", { error: error.message });
              return;
            }

            const sendverifyEmail = await sendEmail({
              email: data.email,
              subject: "Verify your email",
            });

            if (!sendverifyEmail) {
              console.log("Error sending email");
              io.to(socket.id).emit("signup:error", {
                error: "Error sending email",
              });
              return;
            }

            io.to(socket.id).emit("signup:done", {
              id: results.insertId,
              name: data.name,
              email: data.email,
            });
          }
        );
      }
    );
  });
});
