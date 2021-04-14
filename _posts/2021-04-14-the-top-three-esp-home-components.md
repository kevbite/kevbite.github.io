---
layout: post
title: The Top 3 ESPHome Components
categories:
tags: [ESPHome, ESP8266, ESP32, IoT, Home Assistant]
description: The top 3 ESPHome components that you should include in your next ESP32/ESP8266 Home Assistant project.
comments: true
---

## ESPHome

[ESPHome](https://esphome.io/) allows you to create programs for your ESP8266 and ESP32 by simply creating a yaml configuration file, this allow you to create complex programs and automations with zero code. ESPHome can also expose APIs straight to [Home Assistant](https://www.home-assistant.io/) or via [MQTT](https://mqtt.org/) which allows you to extend your automations beyond just a single ESP chip!

This is a list of the top 3 [ESPHome components](https://esphome.io/components/index.html) that you should install with any ESPHome project.

- [Status LED Component](#status-led-component)
- [WiFi Signal Sensor Component](#wifi-signal-sensor-component)
- [Uptime Sensor Component](#uptime-sensor-component)

### Status LED Component

The [status LED](https://esphome.io/components/status_led.html) is the first component on the list, with the status LED you will need a LED connected to the ESP device and this will indicate the status of the device in the following ways:
- The LED blinks slowly when a warning is active.
- The LED blink quickly when an error is active.

This is a life saver, just by looking at the LED you'll know if something has gone wrong with your automations, normally you'd need to connect the USB and boot up a machine to stream the logs (This can also be done [OTA](https://esphome.io/components/logger.html) if still connected to WiFi).

Lucky enough if you're using one of the [ESP32 Development Boards](https://amzn.to/2ONdD99){:target="_blank"} you can use the extra onboard LED via GPIO02.

[![ESP32 Development Board](/assets/posts/2021-04-14-the-top-three-esp-home-components/esp32-development-board.png "ESP32 Development Boards")](https://amzn.to/2ONdD99){:target="_blank"}

The yaml configuration for this is really simple, at the root level of the yaml file add the fillowing:

```yaml
status_led:
  pin:
    number: GPIO2
```

Once booted up the LED will stay off until there's an issue and the LED will start to blink.

[![ESP32 GPIO02 LED](/assets/posts/2021-04-14-the-top-three-esp-home-components/esp32-development-board-gpio02-led.png "ESP32 GPIO02 LED")](https://amzn.to/2ONdD99){:target="_blank"}

### WiFi Signal Sensor Component

Next up is the [WiFi signal sensor component](https://esphome.io/components/sensor/wifi_signal.html), this exposes the WiFi signal strength in decibels (dB) which can be great to track the connectivity from your WiFi from your ESP devices. You can optionally wire this in to other output components such as the [light components](https://esphome.io/#light-components) but by default this will push the data to Home Assistant if you've got the Home Assistant API enabled in the configuration.

For this we simply add a sensor of `wifi_signal` to our configuration.
```yaml
# Enable Home Assistant API
api:

sensor:
  - platform: wifi_signal
    name: "ESP WiFi Signal"
    update_interval: 30s # defaults to 60s

```

Once done we'll see this as a sensor in Home Assistant.

![Home Assistant WiFi Signal](/assets/posts/2021-04-14-the-top-three-esp-home-components/home-assistant-wifi-signal.png "Home Assistant WiFi Signal")

### Uptime Sensor Component

The last component we're going to cover is the [Uptime Sensor Component](https://esphome.io/components/sensor/uptime.html), this allows you to track the uptime of your esp devices. This is great if you have got some rogue devices as you can tell straight away which ones are crashing and restarting. Similar to the [WiFi Signal Sensor Component](#wifi-signal-sensor-component) you can output the result of this sensor to other components such as the [Display Components](https://esphome.io/#display-components), however, if we have the Home Assistant API enabled the data will get exposed to Home Assistant.

For this we simply add a sensor of `uptime` to our configuration. 
```yaml
# Enable Home Assistant API
api:

sensor:   
  - platform: uptime
    name: "ESP Uptime"
    update_interval: 30s # defaults to 60s
```

Once done we'll see this as a sensor in Home Assistant.

![Home Assistant Uptime](/assets/posts/2021-04-14-the-top-three-esp-home-components/home-assistant-uptime.png "Home Assistant Uptime")

