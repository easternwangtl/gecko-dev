/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* vim: set ft=javascript ts=2 et sw=2 tw=80: */
/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */
/* eslint-disable no-undef */

"use strict";

Services.scriptloader.loadSubScript(
  "chrome://mochitests/content/browser/devtools/client/shared/test/shared-head.js",
  this
);

Services.scriptloader.loadSubScript(
  "chrome://mochitests/content/browser/devtools/client/debugger/new/test/mochitest/helpers.js",
  this
);

const EXAMPLE_URL =
  "http://example.com/browser/devtools/client/webreplay/mochitest/examples/";

// Attach a debugger to a tab, returning a promise that resolves with the
// debugger's toolbox.
async function attachDebugger(tab) {
  const target = await TargetFactory.forTab(tab);
  const toolbox = await gDevTools.showToolbox(target, "jsdebugger");
  return toolbox;
}

async function attachRecordingDebugger(url,
    { waitForRecording } = { waitForRecording: false }) {
  const tab = BrowserTestUtils.addTab(gBrowser, null, { recordExecution: "*" });
  gBrowser.selectedTab = tab;
  openTrustedLinkIn(EXAMPLE_URL + url, "current");

  if (waitForRecording) {
    await once(Services.ppmm, "RecordingFinished");
  }
  const toolbox = await attachDebugger(tab);
  const dbg = createDebuggerContext(toolbox);
  const threadClient = dbg.toolbox.threadClient;

  await threadClient.interrupt();
  return {...dbg, tab, threadClient};
}

// Return a promise that resolves when a breakpoint has been set.
async function setBreakpoint(threadClient, expectedFile, lineno) {
  const {sources} = await threadClient.getSources();
  ok(sources.length == 1, "Got one source");
  ok(RegExp(expectedFile).test(sources[0].url), "Source is " + expectedFile);
  const sourceClient = threadClient.source(sources[0]);
  await sourceClient.setBreakpoint({ line: lineno });
}

function resumeThenPauseAtLineFunctionFactory(method) {
  return async function(threadClient, lineno) {
    threadClient[method]();
    await threadClient.addOneTimeListener("paused", async function(event, packet) {
      const {frames} = await threadClient.getFrames(0, 1);
      const frameLine = frames[0] ? frames[0].where.line : undefined;
      ok(frameLine == lineno, "Paused at line " + frameLine + " expected " + lineno);
    });
  };
}

// Define various methods that resume a thread in a specific way and ensure it
// pauses at a specified line.
var rewindToLine = resumeThenPauseAtLineFunctionFactory("rewind");
var resumeToLine = resumeThenPauseAtLineFunctionFactory("resume");
var reverseStepOverToLine = resumeThenPauseAtLineFunctionFactory("reverseStepOver");
var stepOverToLine = resumeThenPauseAtLineFunctionFactory("stepOver");
var reverseStepInToLine = resumeThenPauseAtLineFunctionFactory("reverseStepIn");
var stepInToLine = resumeThenPauseAtLineFunctionFactory("stepIn");
var reverseStepOutToLine = resumeThenPauseAtLineFunctionFactory("reverseStepOut");
var stepOutToLine = resumeThenPauseAtLineFunctionFactory("stepOut");

// Return a promise that resolves when a thread evaluates a string in the
// topmost frame, with the result throwing an exception.
async function checkEvaluateInTopFrameThrows(threadClient, text) {
  const {frames} = await threadClient.getFrames(0, 1);
  ok(frames.length == 1, "Got one frame");
  const response = await threadClient.eval(frames[0].actor, text);
  ok(response.type == "resumed", "Got resume response from eval");
  await threadClient.addOneTimeListener("paused", function(event, packet) {
    ok(packet.type == "paused" &&
       packet.why.type == "clientEvaluated" &&
       "throw" in packet.why.frameFinished, "Eval threw an exception");
  });
}

// Return a pathname that can be used for a new recording file.
function newRecordingFile() {
  ChromeUtils.import("resource://gre/modules/osfile.jsm", this);
  return OS.Path.join(OS.Constants.Path.tmpDir,
                      "MochitestRecording" + Math.round(Math.random() * 1000000000));
}

function findMessage(hud, text, selector = ".message") {
  return findMessages(hud, text, selector)[0];
}

function findMessages(hud, text, selector = ".message") {
  const messages = hud.ui.outputNode.querySelectorAll(selector);
  const elements = Array.prototype.filter.call(
    messages,
    (el) => el.textContent.includes(text)
  );

  if (elements.length == 0) {
    return null;
  }

  return elements;
}

function waitForMessages(hud, text, selector = ".message") {
  return waitUntilPredicate(() => findMessages(hud, text, selector));
}

async function warpToMessage(hud, threadClient, text) {
  let messages = await waitForMessages(hud, text);
  ok(messages.length == 1, "Found one message");
  const message = messages.pop();

  const menuPopup = await openConsoleContextMenu(hud, message);
  console.log(`.>> menu`, menuPopup);

  const timeWarpItem = menuPopup.querySelector("#console-menu-time-warp");
  ok(timeWarpItem, "Time warp menu item is available");

  timeWarpItem.click();

  await Promise.all([
    hideConsoleContextMenu(hud),
    once(Services.ppmm, "TimeWarpFinished"),
    waitForThreadEvents(threadClient, "paused"),
  ]);

  messages = findMessages(hud, "", ".paused");
  ok(messages.length == 1, "Found one paused message");

  return message;
}
