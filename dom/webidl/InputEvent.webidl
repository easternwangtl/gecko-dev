/* -*- Mode: IDL; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/.
 */

[Constructor(DOMString type, optional InputEventInit eventInitDict)]
interface InputEvent : UIEvent
{
  readonly attribute boolean       isComposing;

  [Pref="dom.inputevent.inputtype.enabled"]
  readonly attribute DOMString inputType;
};

dictionary InputEventInit : UIEventInit
{
  boolean isComposing = false;
  DOMString inputType = "";
};
