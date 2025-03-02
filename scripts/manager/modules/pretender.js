const puppeteer = require("puppeteer");

const goToEmojiPage = require("./goToEmojiPage");
const getLocalJson = require("./getLocalJson");
const postEmojiAlias = require("./postEmojiAlias");

const outputLogJson = require("../../utilities/outputLogJson");
const outputResultJson = require("../../utilities/outputResultJson");

const pretender = async (inputs) => {
  const {
    browser: BROWSER,
    configs: CONFIGS,
    debug: DEBUG,
    log: LOG,
    term: TERM,
    time: TIME,
  } = inputs;

  let i = 0; // 再帰でリストの続きから処理するためにインデックスを再帰関数の外に定義する
  let FAILED = false;
  let RELOGIN = false;
  const localDecomojiList = getLocalJson(
    CONFIGS,
    TERM,
    ["rename"],
    "pretender",
    LOG
  );
  const localDecomojiListLength = localDecomojiList.length;

  TERM === "version" &&
    LOG &&
    outputLogJson(localDecomojiList, "list", "pretender");

  const result = {
    error: [],
    error_invalid_alias: [],
    error_name_taken: [],
    error_name_taken_18n: [],
    ok: [],
  };
  const messages = {
    ok: "registered",
    error_invalid_alias: "skipped(target no exists)",
    error_name_taken: "skipped(already exists)",
    error_name_taken_i18n: "skipped(international emoji set already includes)",
  };

  const _pretend = async (inputs) => {
    // puppeteer でブラウザを起動する
    const browser = await puppeteer.launch({
      devtools: BROWSER,
    });
    // ページを追加する
    const page = await browser.newPage();

    // カスタム絵文字管理画面へ遷移する
    inputs = await goToEmojiPage(browser, page, inputs);

    // 再入力されているかもしれないので取り直す
    const { twofactor_code: TWOFACTOR_CODE, workspace: WORKSPACE } = inputs;

    // ローカルのデコモジが存在しなかったらエラーにして終了する
    if (localDecomojiListLength === 0) {
      console.error("[ERROR]No decomoji items.");
      !DEBUG && (await browser.close());
      return;
    }

    TIME && console.time("[Register time]");
    while (i < localDecomojiListLength) {
      const { name, alias_for } = localDecomojiList[i];
      // name か alias_for が falsy の時は FAILED フラグを立ててループを抜ける
      if (!name || !alias_for) {
        FAILED = true;
        break;
      }

      const res = await postEmojiAlias(page, WORKSPACE, name, alias_for);

      console.info(
        `${i + 1}/${localDecomojiListLength}: ${
          res.ok
            ? messages.ok
            : res.error === "error_name_taken" ||
              res.error === "error_name_taken_i18n" ||
              res.error === "error_invalid_alias"
            ? messages[res.error]
            : res.error
        } ${name}.`
      );

      // ログファイルに結果を入れる
      res.ok
        ? result.ok.push(name)
        : res.error === "error_name_taken" ||
          res.error === "error_name_taken_i18n" ||
          res.error === "error_invalid_alias"
        ? result[res.error].push(name)
        : res.error === "ratelimited" // ratelimited エラーの場合はログに残さない
        ? void 0
        : result.error.push({ name, message: res.error });

      // ratelimited エラーの場合
      if (res.error === "ratelimited") {
        // 2FA 利用しているならば 3秒待って同じ i でループを再開する
        if (TWOFACTOR_CODE) {
          console.info("Waiting...");
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        // 2FA 利用でなければ再ログインのためのフラグを立ててループを終了する
        RELOGIN = true;
        break;
      }

      // 特定のエラー以外は失敗フラグを立てる
      if (
        res.error &&
        res.error !== "error_name_taken" && // 登録済みのエラー
        res.error !== "error_name_taken_i18n" && // i18n と競合するエラー
        res.error !== "error_invalid_alias" // エイリアスを貼る先が見つからないエラー
      ) {
        FAILED = true;
        break;
      }

      // インデックスを進める
      i++;
      // ステータスをリセットする
      FAILED = false;
      RELOGIN = false;
    }
    TIME && console.timeEnd("[Register time]");

    // ブラウザを閉じる
    if (!DEBUG) {
      await browser.close();
    }

    // ratelimited なら再帰する
    if (RELOGIN) {
      TIME && console.timeLog("[Total time]");
      console.info("Reconnecting...");
      return await _pretend(inputs);
    }

    // 追加中に ratelimited にならなかった場合ここまで到達する
    if (FAILED) {
      console.error("[ERROR]Register failed.");
    }
    console.info("Register completed!");
    outputResultJson(result, "result", "pretender");
    return;
  };

  // 再帰処理をスタートする
  await _pretend(inputs);
};

module.exports = pretender;
