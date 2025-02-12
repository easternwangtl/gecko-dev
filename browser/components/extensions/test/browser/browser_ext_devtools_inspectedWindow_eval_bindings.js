/* -*- Mode: indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* vim: set sts=2 sw=2 et tw=80: */
"use strict";

loadTestSubscript("head_devtools.js");

/**
 * this test file ensures that:
 *
 * - devtools.inspectedWindow.eval provides the expected $0 and inspect bindings
 */
add_task(async function test_devtools_inspectedWindow_eval_bindings() {
  const TEST_TARGET_URL = "http://mochi.test:8888/";
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, TEST_TARGET_URL);

  function devtools_page() {
    browser.test.onMessage.addListener(async (msg, ...args) => {
      if (msg !== "inspectedWindow-eval-request") {
        browser.test.fail(`Unexpected test message received: ${msg}`);
        return;
      }

      try {
        const [evalResult, errorResult] = await browser.devtools.inspectedWindow.eval(...args);
        browser.test.sendMessage("inspectedWindow-eval-result", {
          evalResult,
          errorResult,
        });
      } catch (err) {
        browser.test.sendMessage("inspectedWindow-eval-result");
        browser.test.fail(`Error: ${err} :: ${err.stack}`);
      }
    });
  }

  let extension = ExtensionTestUtils.loadExtension({
    manifest: {
      devtools_page: "devtools_page.html",
    },
    files: {
      "devtools_page.html": `<!DOCTYPE html>
      <html>
       <head>
         <meta charset="utf-8">
         <script text="text/javascript" src="devtools_page.js"></script>
       </head>
       <body>
       </body>
      </html>`,
      "devtools_page.js": devtools_page,
    },
  });

  await extension.startup();

  const {toolbox} = await openToolboxForTab(tab);

  // Test $0 binding with no selected node
  info("Test inspectedWindow.eval $0 binding with no selected node");

  const evalNoSelectedNodePromise = extension.awaitMessage(`inspectedWindow-eval-result`);
  extension.sendMessage(`inspectedWindow-eval-request`, "$0");
  const evalNoSelectedNodeResult = await evalNoSelectedNodePromise;

  Assert.deepEqual(evalNoSelectedNodeResult,
                   {evalResult: undefined, errorResult: undefined},
                   "Got the expected eval result");

  // Test $0 binding with a selected node in the inspector.

  await openToolboxForTab(tab, "inspector");

  info("Test inspectedWindow.eval $0 binding with a selected node in the inspector");

  const evalSelectedNodePromise = extension.awaitMessage(`inspectedWindow-eval-result`);
  extension.sendMessage(`inspectedWindow-eval-request`, "$0 && $0.tagName");
  const evalSelectedNodeResult = await evalSelectedNodePromise;

  Assert.deepEqual(evalSelectedNodeResult,
                   {evalResult: "BODY", errorResult: undefined},
                   "Got the expected eval result");

  // Test that inspect($0) switch the developer toolbox to the inspector.

  await openToolboxForTab(tab, TOOLBOX_BLANK_PANEL_ID);

  const inspectorPanelSelectedPromise = (async () => {
    const toolId = await toolbox.once("select");

    if (toolId === "inspector") {
      const selectedNodeName = toolbox.selection.nodeFront &&
                               toolbox.selection.nodeFront._form.nodeName;
      is(selectedNodeName, "HTML", "The expected DOM node has been selected in the inspector");
    } else {
      throw new Error(`inspector panel expected, ${toolId} has been selected instead`);
    }
  })();

  info("Test inspectedWindow.eval inspect() binding called for a DOM element");
  const inspectDOMNodePromise = extension.awaitMessage(`inspectedWindow-eval-result`);
  extension.sendMessage(`inspectedWindow-eval-request`, "inspect(document.documentElement)");
  await inspectDOMNodePromise;

  info("Wait for the toolbox to switch to the inspector and the expected node has been selected");
  await inspectorPanelSelectedPromise;
  info("Toolbox has been switched to the inspector as expected");

  info("Test inspectedWindow.eval inspect() binding called for a JS object");

  const splitPanelOpenedPromise = (async () => {
    await toolbox.once("split-console");
    const {hud} = toolbox.getPanel("webconsole");
    let {jsterm} = hud;

    // Wait for the message to appear on the console.
    const messageNode = await new Promise(resolve => {
      jsterm.hud.on("new-messages", function onThisMessage(messages) {
        for (let m of messages) {
          resolve(m.node);
          jsterm.hud.off("new-messages", onThisMessage);
          return;
        }
      });
    });
    let objectInspectors = [...messageNode.querySelectorAll(".tree")];
    is(objectInspectors.length, 1, "There is the expected number of object inspectors");

    // We need to wait for the object to be expanded so we don't call the server on a closed connection.
    const [oi] = objectInspectors;
    let nodes = oi.querySelectorAll(".node");

    ok(nodes.length >= 1, "The object preview is rendered as expected");

    // The tree can still be collapsed since the properties are fetched asynchronously.
    if (nodes.length === 1) {
      info("Waiting for the object properties to be displayed");
      // If this is the case, we wait for the properties to be fetched and displayed.
      await new Promise(resolve => {
        const observer = new MutationObserver(mutations => {
          resolve();
          observer.disconnect();
        });
        observer.observe(oi, {childList: true});
      });

      // Retrieve the new nodes.
      nodes = oi.querySelectorAll(".node");
    }

    // We should have 3 nodes :
    //   ▼ Object { testkey: "testvalue" }
    //   |  testkey: "testvalue"
    //   |  ▶︎ __proto__: Object { … }
    is(nodes.length, 3, "The object preview has the expected number of nodes");
  })();

  const inspectJSObjectPromise = extension.awaitMessage(`inspectedWindow-eval-result`);
  extension.sendMessage(`inspectedWindow-eval-request`, "inspect({testkey: 'testvalue'})");
  await inspectJSObjectPromise;

  info("Wait for the split console to be opened and the JS object inspected");
  await splitPanelOpenedPromise;
  info("Split console has been opened as expected");

  await closeToolboxForTab(tab);

  await extension.unload();

  BrowserTestUtils.removeTab(tab);
});
