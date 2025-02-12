/* Copyright 2018 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

"use strict";

const {Services} = ChromeUtils.import("resource://gre/modules/Services.jsm");
const {XPCOMUtils} = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");

ChromeUtils.defineModuleGetter(this, "PdfStreamConverter",
  "resource://pdf.js/PdfStreamConverter.jsm");

// Register/unregister a constructor as a factory.
function StreamConverterFactory() {
  if (Services.cpmm.sharedData.get("pdfjs.enabled")) {
    return new PdfStreamConverter();
  }
  throw Cr.NS_ERROR_FACTORY_NOT_REGISTERED;
}
StreamConverterFactory.prototype = {
  // properties required for XPCOM registration:
  classID: Components.ID("{d0c5195d-e798-49d4-b1d3-9324328b2291}"),
  classDescription: "pdf.js Component",
};

var NSGetFactory = XPCOMUtils.generateNSGetFactory([StreamConverterFactory]);
