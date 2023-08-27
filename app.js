const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

// GETTING USER FOLLOWING PEOPLE ID's

const getFollowingPeopleIdsOfUser = async (username) => {
  const getTheFollowingPeopleQuery = `SELECT following_user_id FROM follower INNER JOIN user ON user.user_id = follower.follower_user_id WHERE user.username = '${username}';`;
  const followingPeople = await db.all(getTheFollowingPeopleQuery);
  const arrayOfIds = followingPeople.map(
    (eachUser) => eachUser.following_user_id
  );
  return arrayOfIds;
};

// AuthenticateToken Middleware Function
const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        console.log(payload);
        request.username = payload.username;
        request.userId = payload.userId;
        next();
      }
    });
  }
};

// TWEET ACCESS VERIFICATION

const tweetAccessVerification = async (request, response, next) => {
  const { username } = request;
  //console.log(username);
  const { tweetId } = request.params;
  //console.log(tweetId);
  const getUserId = `SELECT user_id FROM user WHERE username = '${username}';`;
  const getUserIdResponse = await db.get(getUserId);
  //console.log(getUserIdResponse);
  const getTweetQuery = `SELECT * FROM tweet INNER JOIN follower ON tweet.user_id = follower.following_user_id 
  WHERE tweet.tweet_id = '${tweetId}' AND follower.follower_user_id = '${getUserIdResponse.user_id}';`;
  const tweet = await db.get(getTweetQuery);
  //console.log(tweet);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

//User Register API 1
app.post("/register/", async (request, response) => {
  const { username, name, password, gender, location } = request.body;
  const hashedPassword = await bcrypt.hash(request.body.password, 10);
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const createUserQuery = `
      INSERT INTO 
        user (username, password, name, gender) 
      VALUES 
        (
          '${username}', 
          '${hashedPassword}',
          '${name}',
          '${gender}'
        )`;
      await db.run(createUserQuery);
      response.send(`User created successfully`);
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//User Login API 2
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      console.log(jwtToken);
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// GET API 3 Returns the latest tweets of people whom the user follows. Return 4 tweets at a time
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  const followingPeopleIds = await getFollowingPeopleIdsOfUser(username);
  const getTweetFeedQuery = `SELECT username, tweet, date_time as dateTime FROM user INNER JOIN tweet ON user.user_id = tweet.user_id WHERE user.user_id IN (${followingPeopleIds}) ORDER BY date_time DESC LIMIT 4;`;
  const getTweetFeedResponse = await db.all(getTweetFeedQuery);
  response.send(getTweetFeedResponse);
});

// GET API 4 Returns the list of all names of people whom the user follows
app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserIdQuery = `SELECT user_id FROM user WHERE user.username = '${username}';`;
  const getUserIdResponse = await db.get(getUserIdQuery);
  //console.log(getUserIdResponse);
  const getUserFollowingQuery = `SELECT name FROM follower INNER JOIN user ON user.user_id = follower.following_user_id WHERE follower.follower_user_id = '${getUserIdResponse.user_id}';`;
  const getUserFollowingResponse = await db.all(getUserFollowingQuery);
  response.send(getUserFollowingResponse);
});

// GET API 5 Returns the list of all names of people who follows the user
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserIdQuery = `SELECT user_id FROM user WHERE user.username = '${username}';`;
  const getUserIdResponse = await db.get(getUserIdQuery);
  //console.log(getUserIdResponse);
  const getUserFollowingQuery = `SELECT DISTINCT name FROM follower INNER JOIN user ON user.user_id = follower.follower_user_id WHERE follower.following_user_id = '${getUserIdResponse.user_id}';`;
  const getUserFollowingResponse = await db.all(getUserFollowingQuery);
  response.send(getUserFollowingResponse);
});

// GET API 6
app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const { username } = request;
    console.log(username);
    const { tweetId } = request.params;
    console.log(tweetId);
    const getTweetQuery = `SELECT tweet, (SELECT COUNT() FROM like WHERE tweet_id = '${tweetId}') AS likes, (SELECT COUNT() FROM reply WHERE tweet_id = '${tweetId}') AS replies, date_time AS dateTime FROM tweet WHERE tweet.tweet_id = '${tweetId}';`;
    const tweet = await db.get(getTweetQuery);
    response.send(tweet);
  }
);

// GET API 7
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getLikesQuery = `SELECT username FROM user INNER JOIN like ON user.user_id = like.user_id WHERE tweet_id = '${tweetId}';`;
    const likedUsers = await db.all(getLikesQuery);
    const usersArray = likedUsers.map((eachUser) => eachUser.username);
    if (usersArray !== "") {
      response.send({ likes: usersArray });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

// GET API 8
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getRepliesQuery = `SELECT name, reply FROM user INNER JOIN reply ON user.user_id = reply.user_id WHERE tweet_id = '${tweetId}';`;
    const repliedUsers = await db.all(getRepliesQuery);
    if (repliedUsers !== undefined) {
      response.send({ replies: repliedUsers });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

// GET API 9
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserId = `SELECT user_id FROM user WHERE username = '${username}';`;
  const getUserIdResponse = await db.get(getUserId);
  //console.log(getUserIdResponse.user_id);

  const getTweetsQuery = `SELECT tweet, COUNT(DISTINCT like_id) AS likes, COUNT (DISTINCT reply_id) AS replies, date_time AS dateTime FROM tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id LEFT JOIN like ON tweet.tweet_id = like.tweet_id WHERE tweet.user_id = ${getUserIdResponse.user_id} GROUP BY tweet.tweet_id;`;
  const tweets = await db.all(getTweetsQuery);
  response.send(tweets);
});

// GET API 10
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  //console.log(tweet);
  const { tweetId } = request;
  const { username } = request;
  const getUserId = `SELECT user_id FROM user WHERE username = '${username}';`;
  const getUserIdResponse = await db.get(getUserId);
  //console.log(getUserIdResponse.user_id);
  const user_id = parseInt(getUserIdResponse.user_id);
  console.log(typeof user_id);
  const createTweetQuery = `INSERT INTO tweet (tweet, user_id) VALUES('${tweet}', ${user_id});`;
  await db.run(createTweetQuery);
  response.send("Created a Tweet");
});

// GET API 11
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const getUserId = `SELECT user_id FROM user WHERE username = '${username}';`;
    const getUserIdResponse = await db.get(getUserId);
    //console.log(getUserIdResponse.user_id);

    const getTheTweetQuery = `SELECT * FROM tweet WHERE user_id = ${getUserIdResponse.user_id} AND tweet_id = '${tweetId}';`;
    const tweet = await db.get(getTheTweetQuery);
    if (tweet !== undefined) {
      const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id = '${tweetId}';`;
      await db.run(deleteTweetQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
