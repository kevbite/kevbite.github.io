---
layout: post
title: Using secure string
categories:
tags: [.NET, C#]
description: Simple overview on when to use SecureString
comments: true
---

## Overview

The secure string class lives within the `System.Security` namespace and has been around since .NET Framework 2.0 was released.

MSDN description of `SecureString`:
> Represents text that should be kept confidential. The text is encrypted for privacy when being used, and deleted from computer memory when no longer needed.

## Is It Already Used?
If we take a quick look within the .NET framework, we will see that it's used in a fair few places.

Start-up ILSpy and look up the SecureString class using the search functionality and then check what the SecureString is 'Instantiated By'.

The below 2 classes came up within ILSpy search with the assemblies that I had already pre-loaded:

* `System.Net.NetworkCredential`
* `System.Windows.Controls.PasswordBox`

If you've ever worked with the `NetworkCredential` object you might have seen that there is 2 properties on it, one of `Password` of type string and another of `SecurePassword` of type SecureString.

The `PasswordBox` object is similar having a `Password` property of type string and a `SecurePassword` property of type SecureString.

If we dig a little deeper in the code for these objects you'll see that all the internals for storing the passwords are actually secure string, the property that is exposing the string version of the password is converting it to a string from its secure form.

This will be by design so that the consumer of the NetworkCredential and PasswordBox objects don't really have to concern them themselves with knowing about secure strings if they don't have to, but allows consumers that are concerned about the security of their system to take full control over how they expose the secure text.

## string vs SecureString

* strings are not encrypted, SecureStrings are encrypted using user, logon session and process.
* strings are not mutable, every time you alter a string you get a new one and the old one if left in memory.
* Since strings are not mutable we can't clean the memory (zero all the memory address out).
* strings are not pinned (stored on the managed heap), so the garbage collector could move them around resulting in copies within memory.
* SecureStrings can be marked as read-only and forced to be disposed (using statements).

## Should I Use SecureString?

If you are working with confidential data such as credit cards, passwords, etc... You should be using SecureString as much as possible when passing it between in methods. Even though it’s not going to be possible to cover all situations you should try to minimize the overall attack surface on your application.

Also try to look for other components that you are using that may expose SecureStrings which then you can continue using in your own stack.

## Overkill.

I've read a few blog posts going over the top. Maybe your string does come in as a normal string within your application but as soon as you get it in as a normal string just convert it and continue with your normal daily practices. I've seen lots of people explaining how you can clean out the incoming string such as the below but unless you desperately need to I would avoid it as you'll end up missing the slightest thing and end up with some nice memory leaks.

```csharp
var myString = "My String Text";
var handle = GCHandle.Alloc(myString, GCHandleType.Pinned);
unsafe
{
	// Zero out the string...
	var pMyString = (char*)handle.AddrOfPinnedObject();
	for (int index = 0; index < myString.Length; index++)
	{
		pMyString[index] = char.MinValue;
	}
}

handle.Free();

// myString = "\0\0\0\0\0\0\0\0\0\0\0\0\0\0"
Console.WriteLine(myString);
```

## Helper Classes

While digging around within ILSpy I stumbled across `SecureStringHelper` but its scope is set to internal which is a shame as I could imagine it would come it useful with external code too.

```csharp
[SuppressUnmanagedCodeSecurity]
internal static class SecureStringHelper
{
	internal static string CreateString(SecureString secureString)
	{
		IntPtr intPtr = IntPtr.Zero;
		if (secureString == null || secureString.Length == 0)
		{
			return string.Empty;
		}
		string result;
		try
		{
			intPtr = Marshal.SecureStringToBSTR(secureString);
			result = Marshal.PtrToStringBSTR(intPtr);
		}
		finally
		{
			if (intPtr != IntPtr.Zero)
			{
				Marshal.ZeroFreeBSTR(intPtr);
			}
		}
		return result;
	}
	internal unsafe static SecureString CreateSecureString(string plainString)
	{
		if (plainString == null || plainString.Length == 0)
		{
			return new SecureString();
		}
		SecureString result;
		fixed (char* value = plainString)
		{
			result = new SecureString(value, plainString.Length);
		}
		return result;
	}
}
```

I'm guessing for the time being a nice copy and paste job will sort us out.

##Conclusion

Using `SecureString` is well worth it, but at the same time I wouldn't go overboard with it. Try keeping the sensitive data as inaccessible as possible when it's not being used and being able to erase your records of it when it is no longer needed. Keep in your mind that you are trying to reduce the attack surface, rather than eliminate it.

I like to try to sum things up using code examples so below puts this in to perspective.

```csharp
static void Main(string[] args)
{
    // Simulate receiving password in non secure form.
    Console.WriteLine("Enter Password");
    var password = Console.ReadLine();

    // Our Internals takes SecureString.
    using(var securePassword = SecureStringHelper.CreateSecureString(password))
	{
		CheckPassword(securePassword);

		// Simulate passing on password in non secure form.
		Console.WriteLine("Password:");
		Console.WriteLine(SecureStringHelper.CreateString(securePassword));
	}
}
```