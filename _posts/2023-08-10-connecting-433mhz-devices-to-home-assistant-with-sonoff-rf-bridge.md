---
layout: post
title: Connecting 433MHz Devices to Home Assistant with Sonoff RF Bridge
categories:
tags: [Home Assistant, ESPHome, Sonoff, RF]
description: How to connect 433MHz Devices to Home Assistant with Sonoff RF Bridge
comments: true
---

## Introduction

I have been using Home Assistant for an extended period, during which I've connected a few 433MHz devices to it. Initially, I utilized [Tasmota](https://tasmota.github.io/) on the Sonoff RF Bridge for communication via MQTT. Lately, I've been considering transitioning from Tasmota to [ESPHome](https://esphome.io/index.html) for improved functionality and integration.

## Hardware Selection

The following hardware components were used in this setup. Though variations may work, these are the ones I've employed:

-   [GS-WDS07 Door Sensor](https://amzn.to/3OwYdSx) ([AliExpress](https://www.aliexpress.com/item/32584419325.html?lan=en&gatewayAdapt=glo2isr&af=54760&dp=7035_1691686672_70caa690203607842c7af840cd4d30a4&cn=1035019x487946677&Afref=Quidco&af=54760&dp=7035_1691686672_70caa690203607842c7af840cd4d30a4&awc=7035_1691686672_70caa690203607842c7af840cd4d30a4&sn=1&aff_fcid=9134abc17c33464d94cbd367c3037033-1691686672852-07451-b8uzCTzW&aff_fsk=b8uzCTzW&aff_platform=promotion&sk=b8uzCTzW&aff_trace_key=9134abc17c33464d94cbd367c3037033-1691686672852-07451-b8uzCTzW&terminal_id=f69303c6420347e0b040e02b4e37cbb9))
-   [Sonoff RF Bridge 433 MHz R2 V1.0](https://amzn.to/3OdLp27) ([AliExpress](https://www.aliexpress.com/item/32825179104.html?lan=en&gatewayAdapt=glo2isr&af=54760&dp=7035_1691686672_70caa690203607842c7af840cd4d30a4&cn=1035019x487946677&Afref=Quidco&af=54760&dp=7035_1691686672_70caa690203607842c7af840cd4d30a4&awc=7035_1691686672_70caa690203607842c7af840cd4d30a4&sn=1&aff_fcid=9134abc17c33464d94cbd367c3037033-1691686672852-07451-b8uzCTzW&aff_fsk=b8uzCTzW&aff_platform=promotion&sk=b8uzCTzW&aff_trace_key=9134abc17c33464d94cbd367c3037033-1691686672852-07451-b8uzCTzW&terminal_id=f69303c6420347e0b040e02b4e37cbb9))
-   [USB to TTL adapter](https://amzn.to/3Ky7wiQ) ([AliExpress](https://www.aliexpress.com/item/1005004742270942.html?lan=en&gatewayAdapt=glo2isr&af=54760&dp=7035_1691686672_70caa690203607842c7af840cd4d30a4&cn=1035019x487946677&Afref=Quidco&af=54760&dp=7035_1691686672_70caa690203607842c7af840cd4d30a4&awc=7035_1691686672_70caa690203607842c7af840cd4d30a4&sn=1&aff_fcid=9134abc17c33464d94cbd367c3037033-1691686672852-07451-b8uzCTzW&aff_fsk=b8uzCTzW&aff_platform=promotion&sk=b8uzCTzW&aff_trace_key=9134abc17c33464d94cbd367c3037033-1691686672852-07451-b8uzCTzW&terminal_id=f69303c6420347e0b040e02b4e37cbb9))

## Exploring ESPHome

ESPHome is an open-source firmware framework designed for ESP8266 and ESP32 devices. It streamlines the creation of DIY IoT devices by utilizing YAML-based configurations that seamlessly integrate with Home Assistant.

The Sonoff RF Bridge is equipped with an ESP8266 chip, and ESPHome conveniently offers a [component integration](https://esphome.io/components/rf_bridge.html) that aligns with this hardware. This makes ESPHome an ideal choice for the Sonoff Bridge.

### Configuration with ESPHome

The following is the ESPHome configuration I applied in my setup:
```yaml
esphome:
  name: rfbridge1

esp8266:
  board: esp01_1m

ota:
  password: "supersecret-ota-password"

wifi:
  ssid: "My-SSID"
  password: "supersecret-wifi-password"

  ap:
    ssid: "Rfbridge1 Fallback Hotspot"
    password: "backup"

api:
  password: "supersecret-api-password"
  services:
    - service: send_rf_code
      variables:
        sync: int
        low: int
        high: int
        code: int
      then:
        - rf_bridge.send_code:
            sync: !lambda 'return sync;'
            low: !lambda 'return low;'
            high: !lambda 'return high;'
            code: !lambda 'return code;'
    - service: learn
      then:
        - rf_bridge.learn

uart:
  tx_pin: 1
  rx_pin: 3
  baud_rate: 19200

logger:
  baud_rate: 0

rf_bridge:
  on_code_received:
    then:
      - homeassistant.event:
          event: esphome.rf_code_received
          data:
            sync: !lambda 'return format_hex(data.sync);'
            low: !lambda 'return format_hex(data.low);'
            high: !lambda 'return format_hex(data.high);'
            code: !lambda 'return format_hex(data.code);'

```

This configuration exposes services for Home Assistant usage. The first service enables sending RF codes to devices. If you're only receiving data from sensors, you can omit this service. The second service, "learn," instructs the RF bridge to learn new protocol timings, allowing it to receive codes and trigger an `on_code_received` event.

The notable aspect of this configuration is the `on_code_received` trigger block. When this trigger is activated, a Home Assistant event named `esphome.rf_code_received` is raised, transmitting the hex-encoded `sync`, `low`, `high`, and `code` data. Using consistent event names across devices allows easy consolidation of received RF code information from multiple RF bridges.

### Flashing the Firmware

To initiate the initial firmware flash, disassemble the RF Bridge and connect the [USB to TTL adapter](https://chat.openai.com/?model=text-davinci-002-render-sha#hardware). Numerous online tutorials cover this process, often used for Tasmota flashing, which aligns closely with this procedure.

-   <https://ubidots.com/blog/sonoff-rf-bridge-433mhz-hack-using-tasmota/#2-rf-bridge-hack>

Once the firmware is installed, the Sonoff RF Bridge is ready to be linked to your WiFi network.

## Home Assistant Configuration

### Integration Setup

The next step involves integrating the Sonoff RF Bridge with Home Assistant. Home Assistant often auto-discovers integrations. Access the settings page where integrations are listed and click the configuration button for the newly discovered integration.

### Learning New Protocols

With the integration in place, navigate to the Developer Tools section and access the services. Here, trigger the "learn" service for the RF Bridge. This service teaches the bridge the protocol timings for your 433MHz device. For example, in my setup, the service is named `rfbridge1_learn`. Execute the service and perform the action with your RF 433MHz device. The RF Bridge will emit a beep upon completion.

![services-learn]

### Sensor Creation

While it's possible to create automations based on the received RF events, a better approach is generating sensors based on these events. In the following sections, I'll demonstrate creating a binary sensor for a door sensor.

Return to the Developer Tools and access the events page. Start listening to all `esphome.rf_code_received` events. Note the codes for when the door is opened and closed.

![listen-to-events]

Next, edit your Home Assistant configuration to include templates for sensors. I recommend using the [Visual Studio Code Add-on](https://community.home-assistant.io/t/home-assistant-community-add-on-visual-studio-code/107863), which simplifies this process. In your configuration, add the following code snippet within the template section:

```yaml
template:
  - trigger:
      - platform: event
        event_type: esphome.rf_code_received
        event_data:
          code: 00432d01
        variables:
          to_state: off
      - platform: event
        event_type: esphome.rf_code_received
        event_data:
          code: 00432a02
        variables:
          to_state: on
    binary_sensor:
      - name: Front door
        device_class: door
        state: "{{ to_state }}"

```

This configuration establishes a binary sensor with the device class "door." This results in default properties such as door icons. The binary sensor's state changes based on the received events with the codes `00432a02` (open) and `00432d01` (closed). Variables set during event triggers are utilized to populate the binary sensor's state.

### Viewing the Results in Home Assistant

Upon returning to your main dashboard, you'll observe the newly created binary sensor. It will accurately reflect the state changes of your door, whether open or closed.

![binary-sensor]

This binary sensor can now be utilized to trigger other automations within Home Assistant. Personally, I've configured mine to activate a light for one minute when the door opens.

```yaml
alias: Front Door Automation
description: Turn on entrance light when front door opens
trigger:
  - platform: state
    entity_id:
      - binary_sensor.front_door
    from: "off"
    to: "on"
action:
  - type: turn_on
    entity_id: light.entrance
    domain: light
  - delay:
      hours: 0
      minutes: 1
      seconds: 0
      milliseconds: 0
  - type: turn_off
    entity_id: light.entrance
    domain: light
mode: single

```

By following these steps, you'll have effectively connected 433MHz devices to Home Assistant using the Sonoff RF Bridge and ESPHome, enhancing your home automation capabilities.


[services-learn]: \assets\posts\2023-08-10-connecting-433mhz-devices-to-home-assistant-with-sonoff-rf-bridge\services-learn.png "Home Assistant - Learn Service"

[listen-to-events]: \assets\posts\2023-08-10-connecting-433mhz-devices-to-home-assistant-with-sonoff-rf-bridge\listen-to-events.png "Home Assistant - Listen to Events"

[binary-sensor]: \assets\posts\2023-08-10-connecting-433mhz-devices-to-home-assistant-with-sonoff-rf-bridge\binary-sensor.png "Binary Sensor"
