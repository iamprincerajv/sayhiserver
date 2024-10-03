const { Server } = require("socket.io");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const sendEmail = require("./utils/sendEmail");
require("dotenv").config();

const io = new Server(8000, {
  cors: true,
});

// MySQL connection pool setup
const pool = mysql.createPool({
  host: process.env.HOST,
  user: process.env.USER,
  password: process.env.PASSWORD,
  database: process.env.DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  maxIdle: 0,
  idleTimeout: 60000,
  enableKeepAlive: true,
});

// connection.connect((err) => {
//   if (err) {
//     console.error("Error connecting to MySQL:", err.stack);
//     return;
//   }
//   console.log("Connected to MySQL as id " + connection.threadId);
// });

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

  socket.on("user:disconnect", ({ to }) => {
    io.to(to).emit("user:disconnect", { from: socket.id });
  });

  // DB operations
  // SIGNUP
  socket.on("signup", (data) => {
    pool.getConnection((err, connection) => {
      if (err) {
        io.to(socket.id).emit("signup:error", { error: err.message });
        return;
      }
      console.log("Connected to MySQL ", connection.threadId);

      // Check if user already exists
      connection.query(
        "SELECT * FROM users WHERE email = ?",
        [data.email],
        (error, results) => {
          if (error) {
            io.to(socket.id).emit("signup:error", { error: error.message });
            connection.release();
            return;
          }
          if (results.length > 0) {
            io.to(socket.id).emit("signup:error", {
              error: "User already exists with this email",
            });
            connection.release();
            return;
          }

          // Create verification code
          const verificationCode = Math.floor(100000 + Math.random() * 900000);

          // Create hash of password
          const salt = bcrypt.genSaltSync(10);
          const hash = bcrypt.hashSync(data.password, salt);

          // Insert user into DB
          const query =
            "INSERT INTO users (name, email, password, verifyCode, isVerified) VALUES (?, ? , ? , ?, ?)";
          connection.query(
            query,
            [data.name, data.email, hash, verificationCode, 0],
            async (error, results) => {
              if (error) {
                io.to(socket.id).emit("signup:error", { error: error.message });
                connection.release();
                return;
              }

              // Send verification email
              const sendverifyEmail = await sendEmail({
                name: data.name,
                email: data.email,
                subject: "Verify your email",
                code: verificationCode,
              });

              if (!sendverifyEmail) {
                io.to(socket.id).emit("signup:error", {
                  error: "Error sending email",
                });
                connection.release();
                return;
              }

              io.to(socket.id).emit("signup:done", {
                id: results.insertId,
                name: data.name,
                email: data.email,
              });
              connection.release();
            }
          );
        }
      );
    });
  });

  // VERIFY EMAIL
  socket.on("verifyEmail", (data) => {
    pool.getConnection((err, connection) => {
      if (err) {
        io.to(socket.id).emit("signup:error", { error: err.message });
        return;
      }
      console.log("Connected to MySQL ", connection.threadId);

      const { email, verifyCode } = data;
      connection.query(
        "SELECT * FROM users WHERE email = ? AND verifyCode = ?",
        [email, verifyCode],
        (error, results) => {
          if (error) {
            io.to(socket.id).emit("verify:failed", { message: error.message });
            connection.release();
            return;
          }

          if (results.length === 0) {
            io.to(socket.id).emit("verify:failed", {
              message: "Verification failed",
            });
            connection.release();
            return;
          }

          connection.query(
            "UPDATE users SET isVerified = 1, verifyCode = NULL WHERE email = ?",
            [email],
            (error, results) => {
              if (error) {
                io.to(socket.id).emit("verify:failed", {
                  message: error.message,
                });
                connection.release();
                return;
              }

              io.to(socket.id).emit("verify:done", {
                message: "Email verified",
              });
              connection.release();
            }
          );
        }
      );
    });
  });

  // SIGNIN
  socket.on("signin", (data) => {
    pool.getConnection((err, connection) => {
      if (err) {
        io.to(socket.id).emit("signup:error", { error: err.message });
        return;
      }
      console.log("Connected to MySQL ", connection.threadId);

      connection.query(
        "SELECT * FROM users WHERE email = ?",
        [data.email],
        (error, results) => {
          if (error) {
            io.to(socket.id).emit("signin:failed", { message: error.message });
            connection.release();
            return;
          }

          if (results.length === 0) {
            io.to(socket.id).emit("signin:failed", {
              message: "User not found",
            });
            connection.release();
            return;
          }

          const user = results[0];
          const isMatch = bcrypt.compareSync(data.password, user.password);
          if (!isMatch) {
            io.to(socket.id).emit("signin:failed", {
              message: "Incorrect password",
            });
            connection.release();
            return;
          }

          io.to(socket.id).emit("signin:done", {
            id: user.id,
            name: user.name,
            email: user.email,
          });
          connection.release();
        }
      );
    });
  });
});
