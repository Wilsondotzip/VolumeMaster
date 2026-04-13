# VolumeMaster
VolumeMaster is a hardware application mixer for changing the volume of different  windows apps on the fly. No more digging through menus. Easily adjust the volume of your music, voice chat or game to be just how you like it.  This project is still in active development you can see all the features we plan to add [here](#what's-to-come) and if you have any feedback or requests don't hesitate to log an issue.

Recently rebranded to VolumeMaster not all docs are up to date.

## Check out the Wiki For build guides and FAQ!



# Contents:
### [Getting Started](#getting-started)
 - [How things work](#how-things-work)
 - [Requirements](#requirements)
 ### [Features ](#features)
 - [Whats here](#features)
 - [Whats to come](#whats-to-come)
   
# Getting Started:

## How things work
A Python script runs in the background to turn the Arduino's serial inputs into volume changes. The Arduino reads each potentiometer as a separate analogue input, this information (once mapped between [0,100]) is then sent to your computer over a COM port. The python program runs to receive the information and convert it to meaningful volume commands!  below is an image of the DIY version. 

![Image2](https://user-images.githubusercontent.com/58171274/208288002-e05144c8-9d7c-4ace-b45a-9c51406f2135.jpg)

## Requirements
**Windows** is the primary supported platform. This project also includes Linux support via the `VolumeMaster-Linux` directory.
If you have windows you're all set nothing else is needed! Go grab the [latest release](https://github.com/Wilsondotzip/HAMixer/releases) and run it inside its own folder with the config file. You can run either the GUI or headless version.

Alternatively  you can use the [source code](https://github.com/Wilsondotzip/HardwareApplicationMixer/tree/main/Software/Source) instead. 



# Features
Hardware
- 4 Knobs which interface via serial over USB
- 3D printable cases
  
Headless Software
- Map an application's volume to any control knob
- Map input devices volume to any control knob
- Map a VoiceMeeter control to any knob
- Application grouping, to have multiple things controlled by one knob
- Easy to use config files
  
Windows React App
- Easy to use UI with drag and drop mapping
- Search running apps and input devices
- Manage settings
- In-app Notifications for when things go wrong
- Windows Autostart 
- When minimized, software which runs quietly in the background as a tray icon
  
- Linux support. Thanks to emmolab 

## What’s to come...
This project is still in active development, so here are some of the features we plan to add in the future.

- More cases! I mean more! All of the cases, every case. Front controls top controls you name it!
- Buttons for possible functions like muting and config switching. 



